// Pure helpers shared by the unit-test-agent scripts. No dependencies, no I/O here,
// so every rule that decides what the agent may see or change is unit-tested.
import path from 'node:path'

export const PROJECTS = ['frontend', 'backend']

const FRONTEND_EXCLUDED = [
  /^frontend\/src\/main\.tsx$/,
  /^frontend\/src\/test\//,
  /^frontend\/src\/design-system\//,
  /(^|\/)types\.ts$/,
  /\.types\.ts$/,
  /(^|\/)index\.ts$/,
  /\.d\.ts$/,
  /\.stories\.tsx?$/,
  /(^|\/)constants\.tsx?$/,
  /\.constants\.ts$/,
  /^frontend\/src\/features\/todos\/api\/queryKeys\.ts$/,
  /^frontend\/src\/lib\/queryClient\.ts$/,
]
const BACKEND_EXCLUDED = [/^backend\/src\/generated\//, /(^|\/)types\.ts$/, /\.d\.ts$/]

/**
 * Classify a repository path.
 * kind: 'source' (testable code), 'test', 'non-testable' (code we deliberately skip),
 * or 'other' (config, docs, CI, ...).
 */
export function classify(file) {
  if (file.startsWith('frontend/src/') && /\.tsx?$/.test(file)) {
    if (/\.test\.tsx?$/.test(file)) return { project: 'frontend', kind: 'test' }
    if (FRONTEND_EXCLUDED.some((re) => re.test(file))) return { project: 'frontend', kind: 'non-testable' }
    return { project: 'frontend', kind: 'source' }
  }
  if (file.startsWith('backend/tests/') && file.endsWith('.ts')) {
    return { project: 'backend', kind: 'test' }
  }
  if (file.startsWith('backend/src/') && file.endsWith('.ts')) {
    if (BACKEND_EXCLUDED.some((re) => re.test(file))) return { project: 'backend', kind: 'non-testable' }
    return { project: 'backend', kind: 'source' }
  }
  const project = PROJECTS.find((name) => file.startsWith(`${name}/`)) ?? null
  return { project, kind: 'other' }
}

/** Conventional test location for a source file (mirrors the existing repository layout). */
export function testPathFor(file) {
  const { project, kind } = classify(file)
  if (kind !== 'source') return null
  if (project === 'frontend') return file.replace(/\.(tsx?)$/, '.test.$1')
  // Backend tests live flat in backend/tests/, named after the module.
  return `backend/tests/${path.posix.basename(file, '.ts')}.test.ts`
}

/** Parse `git diff --name-status -M` output. Renames are reported under their new path. */
export function parseNameStatus(output) {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, ...paths] = line.split('\t')
      return { status: status[0], path: paths[paths.length - 1] }
    })
}

/**
 * Build the agent's work plan from the changed files.
 * `exists(path)` tells whether a file exists at the PR head.
 */
export function buildPlan(changes, { exists, maxTargets = 20, mode = 'pr' } = {}) {
  const files = changes.map((change) => {
    const info = classify(change.path)
    const testFile = testPathFor(change.path)
    return { ...change, ...info, testFile, testFileExists: testFile ? exists(testFile) : false }
  })
  const candidates = files.filter((file) => file.kind === 'source' && file.status !== 'D')
  const targets = candidates.slice(0, maxTargets)
  const projects = [...new Set(files.filter((f) => f.project && f.kind !== 'other').map((f) => f.project))]
  const deletedSources = files.filter((file) => file.kind === 'source' && file.status === 'D').map((f) => f.path)
  let skipReason = null
  if (!targets.length) {
    skipReason = files.length
      ? 'No testable frontend/backend source files changed (only tests, types, config, docs or excluded paths).'
      : 'No changed files.'
  }
  return {
    mode,
    needsAgent: targets.length > 0,
    skipReason,
    projects: PROJECTS.filter((name) => projects.includes(name) || targets.some((t) => t.project === name)),
    targets: targets.map(({ path: file, status, project, testFile, testFileExists }) => ({
      path: file, status, project, testFile, testFileExists,
    })),
    truncated: candidates.length - targets.length,
    deletedSources,
    files: files.map(({ path: file, status, project, kind }) => ({ path: file, status, project, kind })),
  }
}

// ---------------------------------------------------------------------------
// Patch policy: the agent may only add or change test code.

export const ALLOWED_PATCH_PATHS = [
  /^backend\/tests\/[\w./-]+\.ts$/,
  /^frontend\/src\/[\w./-]+\.test\.tsx?$/,
  /^frontend\/src\/test\/[\w./-]+\.tsx?$/,
]

const FORBIDDEN_ADDED_CODE = [
  { re: /\b(?:it|test|describe)\s*\.\s*(?:only|skip|todo)\b/, why: 'focused/skipped/todo tests are not allowed' },
  { re: /\b(?:xit|xdescribe|fit|fdescribe)\s*\(/, why: 'focused/skipped tests are not allowed' },
  { re: /\b(?:child_process|execSync|spawnSync)\b/, why: 'tests must not spawn processes' },
]

const SECRET_PATTERNS = [
  /sk-ant-[\w-]{10,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]

/** Split a unified git diff into per-file sections. */
export function parseUnifiedDiff(diff) {
  const sections = []
  let current = null
  for (const line of diff.split('\n')) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
    if (header) {
      current = { oldPath: header[1], path: header[2], meta: [], added: [], removed: [] }
      sections.push(current)
      continue
    }
    if (!current) continue
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) current.added.push(line.slice(1))
    else if (line.startsWith('-')) current.removed.push(line.slice(1))
    else if (!line.startsWith(' ') && !line.startsWith('@@')) current.meta.push(line)
  }
  return sections
}

/** Validate an agent patch. Returns a list of human-readable violations (empty = OK). */
export function checkPatch(diff, { maxFiles = 30, maxAddedLines = 4000 } = {}) {
  const violations = []
  const sections = parseUnifiedDiff(diff)
  if (sections.length > maxFiles) violations.push(`Patch touches ${sections.length} files (limit ${maxFiles}).`)
  let added = 0
  for (const section of sections) {
    const label = section.path
    if (section.oldPath !== section.path) violations.push(`${label}: renames are not allowed.`)
    if (!ALLOWED_PATCH_PATHS.some((re) => re.test(section.path)) || section.path.includes('..')) {
      violations.push(`${label}: only test files may be changed.`)
    }
    if (section.meta.some((m) => m.startsWith('deleted file mode'))) violations.push(`${label}: deleting files is not allowed.`)
    if (section.meta.some((m) => /^(new file mode|new mode|old mode) (?!100644)/.test(m))) {
      violations.push(`${label}: symlinks, executables and special file modes are not allowed.`)
    }
    if (section.meta.some((m) => m.startsWith('GIT binary patch') || m.startsWith('Binary files'))) {
      violations.push(`${label}: binary content is not allowed.`)
    }
    added += section.added.length
    section.added.forEach((line) => {
      for (const rule of FORBIDDEN_ADDED_CODE) {
        if (rule.re.test(line)) violations.push(`${label}: ${rule.why} (\`${line.trim().slice(0, 80)}\`).`)
      }
      if (SECRET_PATTERNS.some((re) => re.test(line))) violations.push(`${label}: content looks like a secret.`)
    })
  }
  if (added > maxAddedLines) violations.push(`Patch adds ${added} lines (limit ${maxAddedLines}).`)
  return violations
}

// ---------------------------------------------------------------------------
// Reporting

/** Pick coverage entries for the given repo-relative files from a coverage-summary.json. */
export function coverageFor(summary, files, projectDir) {
  const byRelative = {}
  for (const [key, value] of Object.entries(summary)) {
    if (key === 'total') continue
    const marker = `/${projectDir}/`
    const index = key.lastIndexOf(marker)
    if (index >= 0) byRelative[`${projectDir}/${key.slice(index + marker.length)}`] = value
  }
  return files.map((file) => ({
    file,
    lines: byRelative[file]?.lines?.pct ?? null,
    branches: byRelative[file]?.branches?.pct ?? null,
    functions: byRelative[file]?.functions?.pct ?? null,
  }))
}

/** Neutralise LLM- or PR-controlled text before it is rendered in a PR comment. */
export function sanitize(text, maxLength = 500) {
  return String(text ?? '')
    .replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'))
    .replace(/@(?=[\w-])/g, '@​') // do not ping users or teams
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .slice(0, maxLength)
}

/** Minimal validation of the agent report against report.schema.json (no dependencies). */
export function validateReport(report) {
  const errors = []
  const isStrings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')
  if (!report || typeof report !== 'object') return ['report is not an object']
  if (typeof report.summary !== 'string') errors.push('summary must be a string')
  if (!isStrings(report.skillsUsed)) errors.push('skillsUsed must be a string array')
  if (!isStrings(report.notes)) errors.push('notes must be a string array')
  if (!Array.isArray(report.decisions)) errors.push('decisions must be an array')
  for (const [i, d] of (report.decisions ?? []).entries()) {
    if (typeof d?.file !== 'string') errors.push(`decisions[${i}].file must be a string`)
    if (!['created', 'updated', 'skipped'].includes(d?.action)) errors.push(`decisions[${i}].action is invalid`)
    if (d?.testFile !== null && typeof d?.testFile !== 'string') errors.push(`decisions[${i}].testFile must be a string or null`)
    if (typeof d?.reason !== 'string') errors.push(`decisions[${i}].reason must be a string`)
    if (!isStrings(d?.scenarios)) errors.push(`decisions[${i}].scenarios must be a string array`)
  }
  if (!Array.isArray(report.testRuns)) errors.push('testRuns must be an array')
  return errors
}
