#!/usr/bin/env node
// Extract and validate the agent's structured report from the stream-json transcript.
//   node extract-report.mjs <dir>   reads <dir>/transcript.jsonl, writes <dir>/agent-report.json
import { readFileSync, writeFileSync } from 'node:fs'
import { validateReport } from './lib.mjs'

const dir = process.argv[2] ?? '.test-agent'
const events = readFileSync(`${dir}/transcript.jsonl`, 'utf8').split('\n').filter(Boolean)
  .map((line) => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
const result = events.reverse().find((event) => event.type === 'result')
if (!result) {
  console.error('No result event in the transcript.')
  process.exit(1)
}
console.log(JSON.stringify({ subtype: result.subtype, turns: result.num_turns, cost_usd: result.total_cost_usd, duration_ms: result.duration_ms }))
const report = result.structured_output
const errors = validateReport(report)
if (errors.length) {
  console.error(`Agent report is missing or invalid:\n- ${errors.join('\n- ')}`)
  process.exit(1)
}
writeFileSync(`${dir}/agent-report.json`, `${JSON.stringify(report, null, 2)}\n`)
