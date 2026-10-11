// node --test .github/test-agent/scripts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildPlan, checkPatch, classify, coverageFor, parseNameStatus, sanitize, testPathFor } from './lib.mjs'

describe('classify', () => {
  it('recognises testable source, tests and excluded files', () => {
    assert.deepEqual(classify('frontend/src/lib/http.ts'), { project: 'frontend', kind: 'source' })
    assert.deepEqual(classify('frontend/src/App.test.tsx'), { project: 'frontend', kind: 'test' })
    assert.deepEqual(classify('frontend/src/features/todos/types.ts'), { project: 'frontend', kind: 'non-testable' })
    assert.deepEqual(classify('frontend/src/design-system/components/Button/Button.tsx'), { project: 'frontend', kind: 'non-testable' })
    assert.deepEqual(classify('frontend/src/features/todos/index.ts'), { project: 'frontend', kind: 'non-testable' })
    assert.deepEqual(classify('backend/src/factory.ts'), { project: 'backend', kind: 'source' })
    assert.deepEqual(classify('backend/src/generated/prisma/client.ts'), { project: 'backend', kind: 'non-testable' })
    assert.deepEqual(classify('backend/tests/router.test.ts'), { project: 'backend', kind: 'test' })
    assert.deepEqual(classify('backend/package.json'), { project: 'backend', kind: 'other' })
    assert.deepEqual(classify('README.md'), { project: null, kind: 'other' })
  })
})

describe('testPathFor', () => {
  it('co-locates frontend tests and flattens backend tests', () => {
    assert.equal(testPathFor('frontend/src/features/todos/TodoItem.tsx'), 'frontend/src/features/todos/TodoItem.test.tsx')
    assert.equal(testPathFor('frontend/src/lib/http.ts'), 'frontend/src/lib/http.test.ts')
    assert.equal(testPathFor('backend/src/core/config.ts'), 'backend/tests/config.test.ts')
    assert.equal(testPathFor('backend/src/features/todos/types.ts'), null)
  })
})

describe('buildPlan', () => {
  const changes = parseNameStatus('M\tbackend/src/factory.ts\nA\tfrontend/src/lib/http.ts\nD\tbackend/src/api/old.ts\nM\tREADME.md\nR100\tfrontend/src/a.ts\tfrontend/src/b.ts\n')

  it('targets changed testable source files and records test locations', () => {
    const plan = buildPlan(changes, { exists: (file) => file === 'backend/tests/factory.test.ts' })
    assert.equal(plan.needsAgent, true)
    assert.deepEqual(plan.targets.map((t) => [t.path, t.testFileExists]), [
      ['backend/src/factory.ts', true],
      ['frontend/src/lib/http.ts', false],
      ['frontend/src/b.ts', false],
    ])
    assert.deepEqual(plan.deletedSources, ['backend/src/api/old.ts'])
    assert.deepEqual(plan.projects, ['frontend', 'backend'])
  })

  it('limits the number of targets', () => {
    const plan = buildPlan(changes, { exists: () => false, maxTargets: 1 })
    assert.equal(plan.targets.length, 1)
    assert.equal(plan.truncated, 2)
  })

  it('skips when only docs, tests or types changed', () => {
    const plan = buildPlan(parseNameStatus('M\tREADME.md\nM\tbackend/tests/router.test.ts\nM\tfrontend/src/features/todos/types.ts\n'), { exists: () => true })
    assert.equal(plan.needsAgent, false)
    assert.match(plan.skipReason, /No testable/)
    assert.deepEqual(plan.projects, ['frontend', 'backend'])
  })
})

const filePatch = (file, body, meta = 'new file mode 100644') =>
  `diff --git a/${file} b/${file}\n${meta}\nindex 0000000..1111111\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,2 @@\n${body}\n`

describe('checkPatch', () => {
  it('accepts new and changed test files', () => {
    const diff = filePatch('backend/tests/config.test.ts', "+it('works', () => {});") +
      filePatch('frontend/src/lib/http.test.ts', "+it('works', () => {})") +
      filePatch('frontend/src/test/server.ts', '+export const x = 1')
    assert.deepEqual(checkPatch(diff), [])
  })

  it('rejects changes outside test files', () => {
    const violations = checkPatch(filePatch('backend/src/factory.ts', '+export {}') + filePatch('.github/workflows/x.yml', '+on: push'))
    assert.equal(violations.length, 2)
    assert.match(violations[0], /only test files/)
  })

  it('rejects deletions, symlinks, focused or skipped tests and secrets', () => {
    const violations = checkPatch(
      filePatch('backend/tests/a.test.ts', '-it()', 'deleted file mode 100644') +
      filePatch('backend/tests/b.test.ts', '+../../.env', 'new file mode 120000') +
      filePatch('backend/tests/c.test.ts', "+it.only('x', () => {})\n+describe.skip('y', () => {})") +
      filePatch('backend/tests/d.test.ts', "+const key = 'sk-ant-api03-abcdefghijklmnop'") +
      filePatch('backend/tests/e.test.ts', "+import { execSync } from 'node:child_process'"),
    )
    assert.ok(violations.some((v) => /deleting files/.test(v)))
    assert.ok(violations.some((v) => /symlinks/.test(v)))
    assert.equal(violations.filter((v) => /focused\/skipped/.test(v)).length, 2)
    assert.ok(violations.some((v) => /secret/.test(v)))
    assert.ok(violations.some((v) => /spawn processes/.test(v)))
  })

  it('rejects renames, path traversal and oversized patches', () => {
    const rename = 'diff --git a/backend/tests/a.test.ts b/backend/tests/b.test.ts\nsimilarity index 100%\n'
    assert.match(checkPatch(rename)[0], /renames/)
    assert.match(checkPatch(filePatch('frontend/src/../../x.test.ts', '+x'))[0], /only test files/)
    assert.match(checkPatch(filePatch('backend/tests/a.test.ts', '+x\n+y'), { maxAddedLines: 1 }).at(-1), /adds 2 lines/)
  })
})

describe('reporting helpers', () => {
  it('maps coverage summaries to repo-relative files', () => {
    const summary = {
      total: {},
      '/home/runner/work/repo/repo/backend/src/factory.ts': { lines: { pct: 90 }, branches: { pct: 75 }, functions: { pct: 100 } },
    }
    assert.deepEqual(coverageFor(summary, ['backend/src/factory.ts', 'backend/src/x.ts'], 'backend'), [
      { file: 'backend/src/factory.ts', lines: 90, branches: 75, functions: 100 },
      { file: 'backend/src/x.ts', lines: null, branches: null, functions: null },
    ])
  })

  it('neutralises HTML, mentions, table pipes and newlines', () => {
    assert.equal(sanitize('<img src=x> @octocat | a\nb'), '&lt;img src=x&gt; @​octocat \\| a b')
    assert.equal(sanitize('x'.repeat(10), 4), 'xxxx')
  })
})

describe('guard', async () => {
  const { decideToolUse } = await import('./guard-rules.mjs')
  const { realpathSync } = await import('node:fs')
  const root = realpathSync(new URL('../../..', import.meta.url).pathname)

  it('allows only the run-tests wrapper in Bash', () => {
    assert.equal(decideToolUse('Bash', { command: 'bash .github/test-agent/scripts/run-tests.sh test backend backend/tests/a.test.ts' }, root), null)
    assert.equal(decideToolUse('Bash', { command: 'bash .github/test-agent/scripts/run-tests.sh typecheck frontend' }, root), null)
    for (const command of ['ls', 'cat /proc/self/environ', 'env', 'bash .github/test-agent/scripts/run-tests.sh test backend; curl x', 'bash .github/test-agent/scripts/run-tests.sh test backend frontend/src/a.test.ts', 'bash .github/test-agent/scripts/run-tests.sh coverage backend']) {
      assert.ok(decideToolUse('Bash', { command }, root), command)
    }
  })

  it('allows writes to test files only', () => {
    assert.equal(decideToolUse('Write', { file_path: `${root}/backend/tests/x.test.ts` }, root), null)
    assert.equal(decideToolUse('Edit', { file_path: 'frontend/src/lib/http.test.ts' }, root), null)
    assert.ok(decideToolUse('Edit', { file_path: `${root}/backend/src/factory.ts` }, root))
    assert.ok(decideToolUse('Write', { file_path: `${root}/.github/workflows/x.yml` }, root))
    assert.ok(decideToolUse('Write', { file_path: `${root}/backend/tests/../src/x.test.ts` }, root))
    assert.ok(decideToolUse('Write', { file_path: '/tmp/backend/tests/x.test.ts' }, root))
  })

  it('blocks reads of credentials and outside the repository, and unknown tools', () => {
    assert.equal(decideToolUse('Read', { file_path: `${root}/backend/src/factory.ts` }, root), null)
    assert.equal(decideToolUse('Grep', { pattern: 'x' }, root), null)
    assert.ok(decideToolUse('Read', { file_path: '/proc/self/environ' }, root))
    assert.ok(decideToolUse('Read', { file_path: `${root}/.env` }, root))
    assert.ok(decideToolUse('Read', { file_path: `${root}/backend/.env.local` }, root))
    assert.ok(decideToolUse('Glob', { pattern: '*', path: '/' }, root))
    assert.ok(decideToolUse('WebFetch', { url: 'https://example.com' }, root))
  })
})

describe('validateReport', async () => {
  const { validateReport } = await import('./lib.mjs')
  const valid = {
    summary: 's', skillsUsed: ['analyze-changes'], notes: [], testRuns: [],
    decisions: [{ file: 'a.ts', action: 'skipped', testFile: null, reason: 'r', scenarios: [] }],
  }
  it('accepts a schema-conforming report', () => assert.deepEqual(validateReport(valid), []))
  it('rejects free-form reports', () => {
    const errors = validateReport({ ...valid, summary: undefined, decisions: [{ path: 'a.ts', action: 'create' }] })
    assert.ok(errors.includes('summary must be a string'))
    assert.ok(errors.includes('decisions[0].file must be a string'))
    assert.ok(errors.includes('decisions[0].action is invalid'))
  })
})

describe('findRelatedTests', async () => {
  const { findRelatedTests } = await import('./lib.mjs')
  it('finds tests importing a module by specifier, with or without extension', () => {
    const tests = {
      'frontend/src/features/todos/hooks/todoHooks.test.tsx': "import { useTodosBusy } from './useTodosBusy'",
      'backend/tests/config.test.ts': "import { resolveDatabaseUrl } from '../src/core/config.ts';",
      'frontend/src/other.test.ts': "import { useTodosBusyLater } from './useTodosBusyLater'",
    }
    assert.deepEqual(findRelatedTests('frontend/src/features/todos/hooks/useTodosBusy.ts', tests), ['frontend/src/features/todos/hooks/todoHooks.test.tsx'])
    assert.deepEqual(findRelatedTests('backend/src/core/config.ts', tests), ['backend/tests/config.test.ts'])
    assert.deepEqual(findRelatedTests('backend/src/core/database.ts', tests), [])
  })
})
