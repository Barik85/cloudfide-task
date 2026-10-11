---
name: run-and-fix-tests
description: Run Vitest and TypeScript checks for the Taskly frontend/backend through the sandboxed run-tests.sh wrapper, diagnose failures, and iterate on the tests (never the source) until they pass. Use after writing or changing unit tests.
---

# Run and fix tests

## The only allowed command

```bash
bash .github/test-agent/scripts/run-tests.sh test      <frontend|backend> [repo-relative test files...]
bash .github/test-agent/scripts/run-tests.sh typecheck <frontend|backend>
bash .github/test-agent/scripts/run-tests.sh format    frontend <test files...>   # prettier, frontend only
```

- File arguments must be repo-relative test paths of that project
  (e.g. `frontend/src/lib/http.test.ts`, `backend/tests/config.test.ts`); anything else is rejected.
- The wrapper runs with a scrubbed environment (`TZ=UTC`, `CI=true`, no secrets) and a timeout.
- Do not chain commands (`&&`, `;`, pipes) — they are not permitted.

## Loop (max 3 fix iterations per test file)

1. Run only the files you touched: `run-tests.sh test <project> <files>`.
2. On failure, read the error carefully and classify it:

| Symptom | Likely cause | Fix in the test |
|---|---|---|
| `Cannot find module` / wrong import | path or extension (backend needs `.ts`) | correct the import |
| `vi.mock` factory errors / "hoisted" | variable used inside a hoisted factory | use `vi.hoisted` or `import()` in the factory |
| Unable to find role/text | wrong query or the UI really differs | read the component again, use the actual accessible name |
| `act(...)` warning / state not updated | missing await | `await user...`, `findBy`, `waitFor` |
| Timeout | fake timers + userEvent, or never-resolving promise | `advanceTimers`, resolve mocks |
| Value differs from expectation | your expectation is wrong **or** a source bug | re-read the source; decide (see below) |

3. **Source bug vs. wrong test** — if the source clearly violates its own contract
   (docs, types, validator rules, the PR's evident intent), do **not** encode the bug as expected
   behaviour and do **not** edit the source. Remove that test case, and add a precise note:
   `"src/x.ts: <function> returns … for …, expected … (line N)"`.
4. Frontend only: run `format frontend <your test files>` (CI enforces Prettier).
   After the targeted files pass, run `typecheck` for the project (tests are type-checked too).
5. Finally run the **full suite** for each affected project (`run-tests.sh test <project>`) to make
   sure nothing else broke (e.g. a shared fixture you extended).
6. Re-run a passing new file once more if it involves timers/async to catch flakiness.

## Record

For the report, keep the final numbers of the last full-suite run per project:
`{ project, command, passed, failed }`.
