---
name: backend-unit-tests
description: Conventions and ready-to-adapt patterns for writing Vitest unit tests for the Taskly backend (Express 5 routers via Supertest, Prisma repository with mocked delegates, Zod validators, config/env, app factory). Use whenever creating or updating tests under backend/tests/.
---

# Backend unit tests (Vitest + Supertest)

## Layout & style

- Tests live **flat in `backend/tests/<module>.test.ts`** (vitest `include: tests/**/*.test.ts`).
- Import sources with the **`.ts` extension**: `import { createTodosRouter } from '../src/features/todos/router.ts'`.
- ESM, single quotes, **semicolons**, mostly top-level `it(...)`; `describe` only to group a module.
- `environment: 'node'`. No real PostgreSQL — ever. Unit tests must run on a bare CI runner.
- Shared fixtures: `tests/fixture.ts` exports `record` (Prisma row) and `todo` (API JSON).
- Coverage thresholds: `validators.ts` and `mappers.ts` must stay at **100%** per file.
- Run: `bash .github/test-agent/scripts/run-tests.sh test backend backend/tests/<file>.test.ts`.

## Patterns

### Router (HTTP layer) — inject a fake `TodoStore`

```ts
import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createTodosRouter } from '../src/features/todos/router.ts';
import { todo } from './fixture.ts';

function setup() {
  const repository = { list: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}

it('returns 404 when the task does not exist', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(null);
  const response = await request(app).get('/api/todos/5');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
  expect(repository.get).toHaveBeenCalledWith(5);
});
```

Assert status **and** body **and** what reached the repository (or that it was *not* called on 422).

### Whole app (`createApp` in `src/factory.ts`)

Pass a minimal fake database; the factory builds a real `TodoRepository` on top of it:

```ts
const database = { todo: { findMany: vi.fn().mockResolvedValue([record]), findFirst: vi.fn() } };
const app = createApp(database as unknown as Database);
```

Good targets: 404 JSON for unknown routes, `422 Invalid JSON.` for malformed bodies
(`.set('Content-Type', 'application/json').send('{')`), 413 for oversized bodies (> 100kb),
500 + `console.error` for thrown errors (`vi.spyOn(console, 'error').mockImplementation(() => {})`),
`x-powered-by` header absent, `/openapi.json` served.

### Repository — real Prisma client, mocked IO

```ts
const database = createDatabase('postgresql://test:test@localhost:5432/test'); // never connects
vi.spyOn(database.todo, 'findMany').mockResolvedValue([record]);
```

Always `afterEach(() => vi.restoreAllMocks())`.

### Environment-dependent code (`src/core/config.ts`)

Use `vi.stubEnv(name, value)` + `afterEach(() => vi.unstubAllEnvs())`; stub every variable the
function reads (including empty strings to simulate "missing") so the developer's `.env` cannot
leak into the result. Modules that read env at import time: `vi.resetModules()` then
`await import(...)`.

### Modules with side effects (`src/core/lifespan.ts`, `database.ts`)

Mock collaborators with `vi.mock('../src/core/database.ts', () => ({ ... }))` (path relative to the
test file, same specifier the source resolves to). For servers, listen on port `0` via
`vi.stubEnv('API_PORT', '0')` and always close them in `finally`. Do not register real process
signal handlers without removing them (`process.removeAllListeners('SIGTERM')` in cleanup), and
never let a test call `process.exit` (spy on it).

### Validators (Zod)

Table-driven `it.each` with valid boundaries (120/2000 chars, leap day) and invalid neighbours
(121 chars, `2026-02-30`, wrong types, unknown keys). Use `safeParse(...).success` for rejections.

## Checklist before running

- [ ] Every new branch of the target has at least one test.
- [ ] Error paths assert the exact status code and `detail`.
- [ ] Mocks restored / env unstubbed / servers closed.
- [ ] No `any` leaks that break `tsc` (`npm run typecheck` includes `tests/`).
