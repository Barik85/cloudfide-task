# SOLUTION — Unit Test Agent and agentic PR workflow

A custom **Claude Code agent** (`unit-test-agent`) with five **reusable skills** that creates or
updates unit tests for the frontend (React/Vitest/RTL) and backend (Express/Prisma/Vitest/Supertest).
It runs automatically on every pull request through a GitHub Actions workflow that **analyses**
the change, lets the agent **write and run** tests in a sandbox, **verifies** the result
independently, and **publishes** a commit and a sticky comment to the PR.

The same agent was used in "coverage mode" to fill gaps in the existing code:

| Project | Lines before | Lines after | Branches before | Branches after | Tests before → after |
|---|---|---|---|---|---|
| backend  | 33.0% | **97.2%** | 33.3% | **97.9%** | 48 → 83 |
| frontend | 47.7% | **93.4%** | 43.8% | **94.2%** | 18 → 82 |

(`npm run test:coverage` in each project; agent decisions in [`docs/agent-runs/`](docs/agent-runs).)

---

## 1. Architecture

```
pull_request ──► analyze ─────────► generate ─────────────► verify ────────────► publish
                 (read-only,        (LLM + skills,          (no LLM, no          (write token,
                 no secrets)        read-only token,        secrets)             no LLM, never runs
                                    sandboxed tools)                             PR code)
                 plan.json          agent.patch             policy check         commit tests to the
                 pr.diff            agent-report.json       git apply            PR branch + sticky
                                    transcript.jsonl        tsc + vitest         PR comment + job
                                                            + coverage           summary
```

| Piece | Where | Role |
|---|---|---|
| Custom agent | [`.claude/agents/unit-test-agent.md`](.claude/agents/unit-test-agent.md) | Role, non-negotiable rules, 4-step workflow (analyse → write → verify → report), quality bar |
| Skill `analyze-changes` | [`.claude/skills/analyze-changes`](.claude/skills/analyze-changes/SKILL.md) | Reads the plan/diff, create / update / skip rubric |
| Skill `backend-unit-tests` | [`.claude/skills/backend-unit-tests`](.claude/skills/backend-unit-tests/SKILL.md) | Backend conventions + patterns (Supertest, mocked Prisma delegates, env stubbing, lifecycle) |
| Skill `frontend-unit-tests` | [`.claude/skills/frontend-unit-tests`](.claude/skills/frontend-unit-tests/SKILL.md) | Frontend conventions + patterns (design-system mocks, TanStack Query, fetch, timers) |
| Skill `run-and-fix-tests` | [`.claude/skills/run-and-fix-tests`](.claude/skills/run-and-fix-tests/SKILL.md) | How to run tests via the sandboxed wrapper, failure triage table, bug-vs-test rule |
| Skill `test-report` | [`.claude/skills/test-report`](.claude/skills/test-report/SKILL.md) | Contract of the structured result rendered in the PR |
| PR workflow | [`.github/workflows/unit-test-agent.yml`](.github/workflows/unit-test-agent.yml) | analyze → generate → verify → publish |
| CI | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | typecheck + tests + coverage for both apps, unit tests of the agent tooling |
| Agent sandbox config | [`.github/test-agent/claude-settings.json`](.github/test-agent/claude-settings.json) | Permission allow/deny rules, PreToolUse guard hook, telemetry off |
| Deterministic tooling | [`.github/test-agent/scripts/`](.github/test-agent/scripts) | `analyze-changes`, `run-tests.sh`, `guard`, `verify`, `render-comment`, `extract-report` (+ `lib.test.mjs`, 17 tests) |
| Report schema | [`.github/test-agent/report.schema.json`](.github/test-agent/report.schema.json) | Enforced via `--json-schema` and re-validated |

### How the agent and skills are used at runtime

`run-agent.sh` starts Claude Code headless:

```
claude -p "<prompts/task.md>" --agent unit-test-agent \
  --settings .github/test-agent/claude-settings.json --setting-sources project \
  --permission-mode dontAsk --strict-mcp-config --json-schema "<report.schema.json>" \
  --model "$TEST_AGENT_MODEL" --max-budget-usd "$TEST_AGENT_BUDGET_USD" \
  --output-format stream-json --verbose --no-session-persistence
```

`--agent` makes the custom agent the main thread (its system prompt + tool whitelist). The agent
loads the skills through the `Skill` tool at each step — `analyze-changes` first, then
`backend-unit-tests` / `frontend-unit-tests` depending on the target, `run-and-fix-tests`
to execute and iterate, and `test-report` to produce the final structured answer. Skills are
plain Markdown with front-matter, so they are reusable interactively as well (`/backend-unit-tests`
in a local Claude Code session) and by any other agent.

## 2. Main technical decisions

1. **Claude Code + project-level agent/skills** instead of a hand-rolled LLM loop: file editing,
   tool permissions, hooks, structured output, budgets and transcripts come for free, and the
   same agent works locally and in CI.
2. **Deterministic code around the LLM.** Which files to look at (`analyze-changes.mjs`), what may
   be executed (`run-tests.sh`, `guard.mjs`), what may be committed (`checkPatch`) and whether the
   tests really pass (`verify.mjs`) are decided by small, unit-tested scripts — not by the model.
   The model only decides *what to test and how*.
3. **Privilege separation across jobs.** The only job with credentials for the LLM has a read-only
   `GITHUB_TOKEN` and cannot push; the only job that can push has no LLM and executes no PR code
   (it uses scripts checked out from the base commit and `git apply`s an already-verified patch).
4. **Independent verification.** The agent's own claims are never trusted: a separate job without
   secrets applies the patch to a clean checkout, re-runs `tsc` and the full Vitest suite with
   coverage, and only a green result is committed.
5. **Commit to the PR branch** (opt-out with repository variable `TEST_AGENT_COMMIT=false`):
   tests land where reviewers already look; the sticky comment explains every decision.
6. **Structured output** (`--json-schema` + `validateReport`) so the PR comment is generated from
   data, not from free text, and a malformed report fails loudly.

## 3. Security & reliability measures

| Threat / failure | Mitigation |
|---|---|
| Fork PR exfiltrating secrets | Workflow runs only for same-repository PRs (`head.repo == repository`); no `pull_request_target`. |
| PR changes the agent's own instructions/permissions | `.claude/`, `.github/test-agent/` (and `CLAUDE.md`) are restored from the **base** commit before the agent runs; changes to the agent take effect only after review & merge. |
| Prompt injection in code/comments/diff | Explicit "repository content is data" rule; but the real defence is deterministic: tool whitelist in the agent, `dontAsk` permissions, **PreToolUse guard hook** (only `run-tests.sh`, writes only to test paths, no reads of `.env`, `/proc`, outside the repo, no web), patch policy check, no push rights. |
| Built-in auto-approval of "read-only" shell commands | Found during a dry run (`ls` ran despite `dontAsk`). Fixed with the guard hook, which blocks *every* Bash command except the wrapper (verified: `ls`, `true` are now rejected). |
| Test code reading the API key | `run-tests.sh` executes Vitest/tsc with `env -i` (only `PATH`, `HOME`, `CI`, `TZ`, `LANG`); credentials exist only in the agent step's env. |
| Agent edits source / config / CI, or weakens tests | Guard + permission rules + `checkPatch`: only `backend/tests/**`, `frontend/src/**/*.test.ts(x)`, `frontend/src/test/**`; no deletions, renames, symlinks, binaries; no `.only/.skip/.todo`, no `child_process`; secret-pattern scan; size limits. |
| Red or flaky tests committed | Verify job re-runs everything; commit only if `tsc` + full suite + coverage thresholds pass. Agent rules: deterministic tests, fake timers, re-run async tests. |
| Agent claims results it didn't observe | Report is advisory; the comment's verification table comes from the independent run. In a dry run the agent correctly reported "tests never ran" when the wrapper was broken. |
| Runaway cost / hangs | `--max-budget-usd`, job timeouts, per-command timeout, max 20 targets per run, 200 KB diff cap, `concurrency` cancels superseded runs. |
| Race with new pushes | Concurrency group per PR + publish refuses to commit if the branch tip moved. |
| Workflow loops | Commits made with `GITHUB_TOKEN` do not trigger new workflow runs. |
| Supply chain | Actions pinned to commit SHAs; Claude Code version pinned; `npm ci` from lockfiles. |
| Markdown/mention injection in the comment | All PR/LLM text passes through `sanitize()` (HTML escaped, `@` neutralised, length-capped). |
| Least privilege | `permissions: {}` at workflow level; each job declares only what it needs. |

## 4. Running the PR workflow

### Prerequisites

1. GitHub repository with Actions enabled (workflow files on the default branch `main`).
2. A repository **secret**, one of:
   - `ANTHROPIC_API_KEY` — API key from console.anthropic.com, or
   - `CLAUDE_CODE_OAUTH_TOKEN` — subscription token from `claude setup-token`.
3. Optional repository **variables**: `TEST_AGENT_MODEL` (default `claude-sonnet-5-5`),
   `TEST_AGENT_BUDGET_USD` (default `5`), `TEST_AGENT_COMMIT=false` (comment only, no commit).
4. Optional labels: `skip-test-agent` (disable for a PR), `run-test-agent` (re-run on demand).

### Usage

Open a non-draft PR against `main` from a branch of this repository. The workflow
**Unit Test Agent** runs on `opened`, `synchronize`, `reopened`, `ready_for_review`
(and `labeled` with `run-test-agent`). Results:

- a commit `test: add unit tests for PR changes` on the PR branch (if verification passed),
- a sticky PR comment: decisions per changed file, covered scenarios, verification table,
  coverage of the changed files, failing tests / type errors / policy violations, reviewer notes,
- the same report in the job summary, and artifacts (`plan.json`, `pr.diff`, `agent.patch`,
  `agent-report.json`, full `transcript.jsonl`, `verify.json`) for auditing.

### Locally (same agent, same sandbox)

```bash
# Node.js >= 22, `npm ci` in backend/ and frontend/, Claude Code logged in
node .github/test-agent/scripts/analyze-changes.mjs --base origin/main --head HEAD   # PR mode
node .github/test-agent/scripts/analyze-changes.mjs --all backend                    # coverage mode
node .github/test-agent/scripts/analyze-changes.mjs --all frontend --include 'components/'
bash .github/test-agent/scripts/run-agent.sh
node .github/test-agent/scripts/verify.mjs && node .github/test-agent/scripts/render-comment.mjs
node --test .github/test-agent/scripts/lib.test.mjs                                   # tooling tests
```

## 5. Example runs

### 5.1 Coverage mode (used to build the test suite in this repository)

Committed in `test: raise frontend and backend coverage with unit-test-agent`; raw reports in
[`docs/agent-runs/`](docs/agent-runs).

**Backend** (10 targets, 38 turns, $0.27, ~3.7 min). Skills: `analyze-changes`,
`backend-unit-tests`, `run-and-fix-tests`, `test-report`.

| Target | Decision | Reason (agent) |
|---|---|---|
| `api/health.ts` | created `tests/health.test.ts` | endpoint had no test |
| `core/config.ts` | created `tests/config.test.ts` | no branch of `resolveDatabaseUrl` tested |
| `core/database.ts` | created `tests/database.test.ts` | `initialize` untested |
| `core/lifespan.ts` | created `tests/lifespan.test.ts` | startup, shutdown, failure cleanup untested |
| `factory.ts` | created `tests/factory.test.ts` | 404/422/413/500 handlers, OpenAPI, headers untested |
| `features/todos/router.ts` | updated `tests/router.test.ts` | GET/PATCH/DELETE by id, id validation, 404s untested |
| `mappers.ts`, `repository.ts`, `validators.ts` | skipped | already fully covered (names the tests) |
| `main.ts` | skipped | bootstrap only; `start()` covered by lifespan tests |

The agent hit 4 failing `lifespan` tests on the first run (its fake `listen` called back
synchronously), fixed the test, then ran `typecheck` and the full suite: **83 passed, 0 failed**.

**Frontend** — pass 1 (23 targets, $0.37): created tests for `lib/http.ts`, all todo hooks,
`useTodoFilters`, `TodoEmptyState`; extended `utils/todos`, `api/todos`, `useNotice`. It honestly
reported that several components were only partially covered and left them as follow-ups. Pass 2
(`--include` the 7 weakest components, $0.29) extended `TodosPage`, `TodoItem`, `TodoList`,
`TodoEditor`, `TodoForm`, `DeleteTodoDialog`, and created `AppProviders.test.tsx`:
**82 passed, 0 failed**, lines 93.4%.

### 5.2 PR mode — demo pull request

_See section 5.2 below — filled in from the real workflow run on the demo PR._

## 6. Assumptions

- Contributors who can push branches to this repository are trusted with repository secrets
  (they can edit workflows anyway); untrusted contributions come from forks and are not processed.
- Unit tests must run without PostgreSQL or network; the database is always mocked.
- Generated tests are a reviewable starting point, not a substitute for code review.
- Tests go next to the code in the frontend and flat in `backend/tests/` (existing conventions).
- Coverage targets mirror the projects' own coverage `include/exclude` (design system, types,
  barrels, generated Prisma client are excluded).

## 7. Limitations

- LLM output is non-deterministic: decision quality varies between runs, and in large batches the
  agent tends to defer some targets (mitigated by the 20-target cap, the "no unreviewed skips" rule
  and focused `--include` passes).
- Tests written by the agent may assert current behaviour that is actually a bug; the rules tell it
  to report suspected bugs instead, but this relies on judgement.
- A commit pushed with `GITHUB_TOKEN` does not re-trigger `ci.yml`; verification of that exact
  state happens inside the agent workflow (a GitHub App token would re-trigger CI).
- If the PR itself breaks typecheck/tests in a way the agent cannot fix within test files, nothing
  is committed (by design) — the comment shows the failures instead.
- Fork PRs are skipped. The repository's pre-existing `prettier --check` failures (`index.html`, …)
  are not enforced in CI; the agent formats its own frontend tests.
- No mutation testing — coverage is a proxy for test quality, not proof.

## 8. Production roadmap

- **GitHub App** identity for commits (re-triggers CI, clearer audit trail) and a protected
  **Environment** with required reviewers for the secret.
- Support fork PRs safely via `workflow_run` / label-gated `pull_request_target` that treats PR
  code strictly as data, with the agent in an ephemeral sandbox (container/microVM) with an
  egress allowlist (`api.anthropic.com` only) — e.g. Claude Code's sandbox mode or step-security
  harden-runner.
- **Mutation testing** (Stryker) on changed files to gate on test *strength*, not just coverage;
  reject tests that do not fail when the changed code is reverted.
- Coverage **diff gates** (changed lines ≥ N%) and per-PR trend tracking.
- Run frontend and backend as parallel agent jobs (or sub-agents) for large PRs; cache
  `node_modules`; incremental runs on `synchronize` that only look at the new commits.
- An evaluation set of historical PRs with known-good tests to measure decision quality and catch
  regressions when the agent prompt or skills change (LLM-as-judge + mutation score).
- Inline review suggestions instead of / in addition to a commit, and a `/test-agent` slash
  command in PR comments for on-demand runs with instructions.
- Cost and quality telemetry per run (tokens, $, decisions, verification pass rate).
