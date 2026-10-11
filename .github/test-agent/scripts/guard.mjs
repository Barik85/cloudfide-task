#!/usr/bin/env node
// PreToolUse hook for unit-test-agent (registered in claude-settings.json).
// Permission rules are the first layer; this hook is the deterministic second layer that
// cannot be bypassed by Claude Code's built-in auto-approval of "read-only" shell commands.
// Exit code 2 blocks the tool call and shows the reason to the agent.
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { decideToolUse } from './guard-rules.mjs'

const input = JSON.parse(readFileSync(0, 'utf8'))
const root = realpathSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..'))
const reason = decideToolUse(input.tool_name, input.tool_input ?? {}, root)
if (reason) {
  process.stderr.write(`Blocked by unit-test-agent guard: ${reason}\n`)
  process.exit(2)
}
