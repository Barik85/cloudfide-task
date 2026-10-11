#!/usr/bin/env node
// Deterministic first step of the unit-test-agent: decide *what* the agent should look at.
//
//   PR mode:       node analyze-changes.mjs --base <sha> --head <sha> [--out .test-agent]
//   Coverage mode: node analyze-changes.mjs --all <frontend|backend> [--include <regex>] [--out .test-agent]
//
// Writes <out>/plan.json (+ <out>/pr.diff in PR mode) and prints GitHub step outputs.
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { PROJECTS, buildPlan, classify, parseNameStatus } from './lib.mjs'

const MAX_DIFF_BYTES = 200_000
const SHA = /^[0-9a-f]{7,40}$/

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    head: { type: 'string' },
    all: { type: 'string' },
    include: { type: 'string' },
    out: { type: 'string', default: '.test-agent' },
    'max-targets': { type: 'string', default: '20' },
  },
})

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const maxTargets = Number(values['max-targets'])
mkdirSync(values.out, { recursive: true })

let plan
if (values.all) {
  if (!PROJECTS.includes(values.all)) throw new Error(`--all expects one of: ${PROJECTS.join(', ')}`)
  const include = values.include ? new RegExp(values.include) : null
  const files = git('ls-files', `${values.all}/`).split('\n').filter((file) => file && (!include || include.test(file)))
  const changes = files.filter((file) => classify(file).kind === 'source').map((file) => ({ status: 'M', path: file }))
  plan = buildPlan(changes, { exists: existsSync, maxTargets, mode: 'coverage' })
} else {
  if (!SHA.test(values.base ?? '') || !SHA.test(values.head ?? '')) throw new Error('--base and --head must be commit SHAs')
  // Three-dot diff: only what the PR introduces relative to the merge base.
  const range = `${values.base}...${values.head}`
  const changes = parseNameStatus(git('diff', '--name-status', '-M', range))
  plan = buildPlan(changes, { exists: existsSync, maxTargets, mode: 'pr' })
  plan.base = values.base
  plan.head = values.head
  const relevant = plan.targets.flatMap((t) => [t.path, ...(t.testFileExists ? [t.testFile] : [])])
  let diff = relevant.length ? git('diff', '--no-color', '-U5', range, '--', ...relevant) : ''
  if (Buffer.byteLength(diff) > MAX_DIFF_BYTES) {
    diff = `${diff.slice(0, MAX_DIFF_BYTES)}\n\n[diff truncated at ${MAX_DIFF_BYTES} bytes - read the files directly]\n`
    plan.diffTruncated = true
  }
  writeFileSync(path.join(values.out, 'pr.diff'), diff)
}

writeFileSync(path.join(values.out, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`)
const outputs = {
  needs_agent: String(plan.needsAgent),
  frontend: String(plan.projects.includes('frontend')),
  backend: String(plan.projects.includes('backend')),
}
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([k, v]) => `${k}=${v}\n`).join(''))
}
console.log(JSON.stringify({ ...outputs, targets: plan.targets.map((t) => t.path), skipReason: plan.skipReason }, null, 2))
