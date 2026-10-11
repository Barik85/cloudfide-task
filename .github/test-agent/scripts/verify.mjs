#!/usr/bin/env node
// Independent verification of the agent's work. Runs WITHOUT secrets and without the LLM:
//   1. policy-check the patch (test files only, no .only/.skip, no secrets, size limits),
//   2. apply it on a clean checkout of the PR head,
//   3. typecheck + run the full test suite with coverage for every affected project,
//   4. write <dir>/verify.json and the `passed` step output.
//
//   node verify.mjs [--dir .test-agent]
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { checkPatch, coverageFor } from './lib.mjs'

const { values } = parseArgs({ options: { dir: { type: 'string', default: '.test-agent' } } })
const dir = values.dir
const runTests = path.join(path.dirname(new URL(import.meta.url).pathname), 'run-tests.sh')
const readJson = (file, fallback = null) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback)

const plan = readJson(path.join(dir, 'plan.json'))
if (!plan) throw new Error(`${dir}/plan.json not found`)
const patchFile = path.join(dir, 'agent.patch')
const patch = existsSync(patchFile) ? readFileSync(patchFile, 'utf8') : ''

const result = {
  patch: { present: patch.trim().length > 0, applied: false, violations: [] },
  projects: {},
  passed: false,
}

if (result.patch.present) {
  result.patch.violations = checkPatch(patch)
  if (!result.patch.violations.length) {
    const apply = spawnSync('git', ['apply', '--index', '--whitespace=nowarn', patchFile], { encoding: 'utf8' })
    result.patch.applied = apply.status === 0
    if (!result.patch.applied) result.patch.violations.push(`git apply failed: ${apply.stderr.trim()}`)
  }
  result.patch.files = execFileSync('git', ['diff', '--cached', '--name-status'], { encoding: 'utf8' })
    .split('\n').filter(Boolean)
}

// Verify the projects touched by the PR even when the agent produced no patch:
// the comment then still tells reviewers whether the PR's own tests pass.
for (const project of plan.projects) {
  const step = (command) => {
    const run = spawnSync('bash', [runTests, command, project], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    process.stdout.write(`\n::group::${command} ${project}\n${run.stdout}${run.stderr}\n::endgroup::\n`)
    return { ok: run.status === 0, output: `${run.stdout}${run.stderr}`.slice(-4000) }
  }
  const typecheck = step('typecheck')
  const tests = step('coverage')
  const vitest = readJson(path.join(dir, `${project}-results.json`), {})
  const failures = (vitest.testResults ?? []).flatMap((file) => {
    const relative = path.relative(process.cwd(), file.name)
    const assertions = (file.assertionResults ?? []).filter((a) => a.status === 'failed')
    // A suite that fails to load (import/syntax error) has no assertion results, only a message.
    if (file.status === 'failed' && !assertions.length) {
      return [{ file: relative, test: '(test file failed to load)', message: String(file.message ?? '').slice(0, 600) }]
    }
    return assertions.map((a) => ({ file: relative, test: a.fullName, message: (a.failureMessages ?? []).join('\n').slice(0, 600) }))
  })
  const summary = readJson(path.join(project, 'coverage', 'coverage-summary.json'), {})
  result.projects[project] = {
    typecheck: typecheck.ok,
    typecheckOutput: typecheck.ok ? '' : typecheck.output,
    tests: tests.ok,
    testsOutput: tests.ok ? '' : tests.output,
    total: vitest.numTotalTests ?? 0,
    passedCount: vitest.numPassedTests ?? 0,
    failedCount: vitest.numFailedTests ?? 0,
    failedSuites: vitest.numFailedTestSuites ?? 0,
    failures: failures.slice(0, 10),
    coverageTotal: summary.total ? { lines: summary.total.lines.pct, branches: summary.total.branches.pct } : null,
    coverage: coverageFor(summary, plan.targets.filter((t) => t.project === project).map((t) => t.path), project),
  }
}

const projectsOk = Object.values(result.projects).every((p) => p.typecheck && p.tests)
result.passed = projectsOk && result.patch.violations.length === 0
writeFileSync(path.join(dir, 'verify.json'), `${JSON.stringify(result, null, 2)}\n`)
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `passed=${result.passed}\npatch_ok=${result.patch.present && result.patch.applied && result.passed}\n`)
}
console.log(`verification ${result.passed ? 'passed' : 'FAILED'}`)
