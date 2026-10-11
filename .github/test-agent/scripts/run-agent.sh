#!/usr/bin/env bash
# Run unit-test-agent headlessly with Claude Code. Used by CI and locally.
#
#   PR mode (CI):   analyze-changes.mjs --base .. --head .. && run-agent.sh
#   Coverage mode:  analyze-changes.mjs --all backend && run-agent.sh
#
# Produces .test-agent/transcript.jsonl (full tool-call log) and .test-agent/agent-report.json.
# Env: TEST_AGENT_MODEL (default claude-sonnet-5-5), TEST_AGENT_BUDGET_USD (default 5),
#      ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN (CI) / local Claude login.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
config="$root/.github/test-agent"
out="$root/.test-agent"
cd "$root"
[[ -f "$out/plan.json" ]] || { echo "Missing $out/plan.json - run analyze-changes.mjs first." >&2; exit 2; }

# The agent's Bash tool may re-source a shell profile; keep the Node.js we were started with.
export TEST_AGENT_PATH="$PATH"

set +e
claude -p "$(cat "$config/prompts/task.md")" \
  --agent unit-test-agent \
  --settings "$config/claude-settings.json" \
  --setting-sources project \
  --permission-mode dontAsk \
  --strict-mcp-config \
  --model "${TEST_AGENT_MODEL:-claude-sonnet-5-5}" \
  --max-budget-usd "${TEST_AGENT_BUDGET_USD:-5}" \
  --json-schema "$(cat "$config/report.schema.json")" \
  --output-format stream-json --verbose \
  --no-session-persistence \
  > "$out/transcript.jsonl"
status=$?
set -e

# The last `result` event carries the schema-validated report (StructuredOutput tool).
node "$config/scripts/extract-report.mjs" "$out"
exit $status
