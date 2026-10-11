#!/usr/bin/env node
// Render the sticky PR comment from plan.json, agent-report.json and verify.json.
//
//   node render-comment.mjs [--dir .test-agent] [--commit <sha>] [--run-url <url>] [--generate <result>]
//
// Everything that originates from the PR or from the LLM is passed through sanitize().
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { sanitize } from './lib.mjs'

export const MARKER = '<!-- unit-test-agent -->'

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: '.test-agent' },
    commit: { type: 'string', default: '' },
    'run-url': { type: 'string', default: '' },
    generate: { type: 'string', default: '' },
  },
})
const readJson = (name) => {
  const file = path.join(values.dir, name)
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null } catch { return null }
}
const plan = readJson('plan.json')
const report = readJson('agent-report.json')
const verify = readJson('verify.json')
const icon = (ok) => (ok ? '✅' : '❌')
const pct = (value) => (value === null || value === undefined ? '–' : `${value}%`)
const code = (value) => `\`${sanitize(value, 200).replace(/`/g, "'")}\``
const lines = [MARKER, '## 🧪 Unit Test Agent', '']

if (!plan) {
  lines.push('The change analysis did not complete. See the workflow run for details.')
} else if (!plan.needsAgent) {
  lines.push(`**No tests generated.** ${sanitize(plan.skipReason)}`)
} else {
  const committed = Boolean(values.commit)
  let status
  if (committed) status = `✅ Generated tests passed verification and were committed in ${values.commit.slice(0, 7)}.`
  else if (values.generate && values.generate !== 'success') status = `⚠️ The agent did not finish (job result: ${sanitize(values.generate, 40)}). Nothing was committed.`
  else if (!verify) status = '⚠️ Verification did not run. Nothing was committed.'
  else if (!verify.patch.present) status = verify.passed ? 'ℹ️ The agent decided no test changes were needed.' : '❌ The agent made no test changes, and the PR does not pass its checks (see below).'
  else if (verify.patch.violations.length) status = '⛔ The agent patch was rejected by the safety policy. Nothing was committed.'
  else if (!verify.passed) status = '❌ Tests or type checking failed after applying the agent patch. Nothing was committed.'
  else status = 'ℹ️ Generated tests passed verification but were not committed (the PR branch moved or committing is disabled).'
  lines.push(`**${status}**`, '')

  if (report?.summary) lines.push(sanitize(report.summary, 1200), '')

  const decisions = report?.decisions ?? []
  if (decisions.length) {
    lines.push('### Decisions', '', '| Changed file | Action | Test file | Reason |', '|---|---|---|---|')
    for (const d of decisions.slice(0, 40)) {
      lines.push(`| ${code(d.file)} | **${sanitize(d.action, 20)}** | ${d.testFile ? code(d.testFile) : '–'} | ${sanitize(d.reason, 300)} |`)
    }
    lines.push('')
    const scenarios = decisions.filter((d) => d.scenarios?.length)
    if (scenarios.length) {
      lines.push('<details><summary>Covered scenarios</summary>', '')
      for (const d of scenarios) {
        lines.push(`- ${code(d.testFile ?? d.file)}`)
        d.scenarios.slice(0, 15).forEach((s) => lines.push(`  - ${sanitize(s, 200)}`))
      }
      lines.push('', '</details>', '')
    }
  }

  if (verify) {
    lines.push('### Verification (independent run, no LLM)', '', '| Project | Type check | Tests | Coverage (lines / branches) |', '|---|---|---|---|')
    for (const [project, p] of Object.entries(verify.projects)) {
      const total = p.coverageTotal ? `${pct(p.coverageTotal.lines)} / ${pct(p.coverageTotal.branches)}` : '–'
      const suites = p.failedSuites ? `, ${p.failedSuites} file(s) failed` : ''
      lines.push(`| ${project} | ${icon(p.typecheck)} | ${icon(p.tests)} ${p.passedCount}/${p.total} passed${suites} | ${total} |`)
    }
    lines.push('')
    const typeErrors = Object.entries(verify.projects).filter(([, p]) => !p.typecheck)
    if (typeErrors.length) {
      lines.push('<details open><summary>Type check errors</summary>', '')
      typeErrors.forEach(([project, p]) => lines.push(`**${project}**`, '', '```', p.typecheckOutput.replace(/```/g, "'''").slice(-2000), '```', ''))
      lines.push('</details>', '')
    }
    const coverage = Object.values(verify.projects).flatMap((p) => p.coverage)
    if (coverage.length) {
      lines.push('<details><summary>Coverage of changed files</summary>', '', '| File | Lines | Branches | Functions |', '|---|---|---|---|')
      coverage.forEach((c) => lines.push(`| ${code(c.file)} | ${pct(c.lines)} | ${pct(c.branches)} | ${pct(c.functions)} |`))
      lines.push('', '</details>', '')
    }
    const failures = Object.values(verify.projects).flatMap((p) => p.failures)
    if (failures.length) {
      lines.push('<details open><summary>Failing tests</summary>', '')
      failures.forEach((f) => lines.push(`- ${code(f.file)} › ${sanitize(f.test, 200)}: ${sanitize(f.message, 300)}`))
      lines.push('', '</details>', '')
    }
    if (verify.patch.violations.length) {
      lines.push('<details open><summary>Policy violations</summary>', '')
      verify.patch.violations.slice(0, 20).forEach((v) => lines.push(`- ${sanitize(v, 300)}`))
      lines.push('', '</details>', '')
    }
  }

  const notes = report?.notes ?? []
  if (notes.length) {
    lines.push('### Notes for reviewers', '')
    notes.slice(0, 10).forEach((n) => lines.push(`- ${sanitize(n, 400)}`))
    lines.push('')
  }
  if (report?.skillsUsed?.length) lines.push(`Skills used: ${report.skillsUsed.slice(0, 10).map(code).join(', ')}`, '')
  if (plan.truncated) lines.push(`_${plan.truncated} more changed source file(s) were not analysed (limit per run)._`, '')
}

lines.push('---', `<sub>${values['run-url'] ? `[Workflow run](${values['run-url']}) · ` : ''}Add the \`skip-test-agent\` label to disable, or \`run-test-agent\` to re-run. Generated tests are a starting point — review them like any other code.</sub>`)
console.log(lines.join('\n'))
