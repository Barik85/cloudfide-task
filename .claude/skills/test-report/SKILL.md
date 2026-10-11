---
name: test-report
description: Produce the structured, machine-readable result of a unit-test-agent run (decisions per changed file, skills used, test runs, reviewer notes) that the PR workflow renders as a pull-request comment. Use as the final step of a test generation task.
---

# Test report

The workflow validates your final answer against `.github/test-agent/report.schema.json`
and renders it into the PR comment. An independent, LLM-free job re-runs all tests afterwards,
so report **facts only** — never claim a run you did not perform.

## Shape

```json
{
  "summary": "PR adds a priority filter to TodoFilters and a `priority` query param to GET /api/todos. Created 1 and updated 2 test files; all tests pass.",
  "skillsUsed": ["analyze-changes", "backend-unit-tests", "frontend-unit-tests", "run-and-fix-tests", "test-report"],
  "decisions": [
    {
      "file": "backend/src/features/todos/router.ts",
      "action": "updated",
      "testFile": "backend/tests/router.test.ts",
      "reason": "New `priority` query filter and 422 on invalid values were untested.",
      "scenarios": ["filters by a valid priority", "rejects an unknown priority with 422"]
    },
    {
      "file": "frontend/src/features/todos/types.ts",
      "action": "skipped",
      "testFile": null,
      "reason": "Type-only change, no runtime behaviour.",
      "scenarios": []
    }
  ],
  "testRuns": [
    { "project": "backend", "command": "run-tests.sh test backend", "passed": 61, "failed": 0 }
  ],
  "notes": ["src/lib/http.ts: 422 responses ignore the server's detail message (line 15) — intended?"]
}
```

## Rules

- One `decisions[]` entry for **every** target in `plan.json`, including skipped ones
  (`testFile: null`, `scenarios: []` when skipped).
- `action` is what you actually did: `created` (new file), `updated` (existing file changed),
  `skipped`.
- `reason`: concrete and specific to the code, one sentence. Avoid filler ("to improve quality").
- `scenarios`: behaviours, phrased like the test names.
- `notes`: suspected source bugs, untestable code, deleted modules with dangling tests, anything a
  reviewer must look at. Empty array if none.
- Plain text only: no HTML, no @-mentions, no links.
