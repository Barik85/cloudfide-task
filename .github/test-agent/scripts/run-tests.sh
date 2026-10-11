#!/usr/bin/env bash
# The only command the unit-test-agent is allowed to execute (see claude-settings.json).
#
#   run-tests.sh test      <frontend|backend> [test files...]   run Vitest (all tests or the given files)
#   run-tests.sh typecheck <frontend|backend>                   tsc --noEmit (includes test files)
#   run-tests.sh format    frontend <test files...>              prettier --write on the given test files
#   run-tests.sh coverage  <frontend|backend>                   full suite + coverage + JSON results
#
# Arguments are validated against a strict allowlist and the test process runs with a
# scrubbed environment, so code under test can never read the agent's API credentials.
set -euo pipefail

usage() { echo "usage: $0 <test|typecheck|format|coverage> <frontend|backend> [test files...]" >&2; exit 2; }
[[ $# -ge 2 ]] || usage
command="$1"; project="$2"; shift 2

case "$project" in frontend|backend) ;; *) usage ;; esac
case "$command" in test|typecheck|format|coverage) ;; *) usage ;; esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
out_dir="$root/.test-agent"
mkdir -p "$out_dir"

files=()
for file in "$@"; do
  # Only repository-relative test files of the selected project; no options, no traversal.
  if [[ "$file" == *..* || ! "$file" =~ ^${project}/[A-Za-z0-9_./-]+\.test\.tsx?$ ]]; then
    echo "Rejected argument: $file (expected a ${project}/... *.test.ts(x) path)" >&2
    exit 2
  fi
  files+=("${file#"${project}"/}")
done
if [[ "$command" != test && "$command" != format && ${#files[@]} -gt 0 ]]; then usage; fi
if [[ "$command" == format && ( "$project" != frontend || ${#files[@]} -eq 0 ) ]]; then usage; fi

# run-agent.sh pins PATH, because the agent's shell may re-source a profile with another Node.
PATH="${TEST_AGENT_PATH:-$PATH}"
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [[ "$node_major" -lt 22 ]]; then echo "Node.js >= 22 is required (found $(node -v 2>/dev/null || echo none))." >&2; exit 3; fi

# Minimal, credential-free environment for everything that executes repository code.
run() {
  local limit=()
  command -v timeout >/dev/null && limit=(timeout --kill-after=10s 600s)
  env -i PATH="$PATH" HOME="${HOME:-/tmp}" CI=true TZ=UTC LANG=C.UTF-8 FORCE_COLOR=0 NO_COLOR=1 \
    ${limit[@]+"${limit[@]}"} "$@"
}

cd "$root/$project"
[[ -d node_modules ]] || { echo "Dependencies missing: run 'npm ci' in $project first." >&2; exit 3; }

case "$command" in
  typecheck)
    run npx --no-install tsc --noEmit
    ;;
  format)
    run npx --no-install prettier --write "${files[@]}"
    ;;
  test)
    # Keep the output bounded so the agent's context stays focused on failures.
    run npx --no-install vitest run --reporter=default ${files[@]+"${files[@]}"} 2>&1 | tail -c 40000
    ;;
  coverage)
    run npx --no-install vitest run --coverage \
      --reporter=default --reporter=json --outputFile.json="$out_dir/$project-results.json" 2>&1 | tail -c 40000
    ;;
esac
