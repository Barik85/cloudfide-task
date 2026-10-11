---
name: frontend-unit-tests
description: Conventions and patterns for Vitest + React Testing Library unit tests in the Taskly frontend (components with design-system mocks, TanStack Query hooks, fetch-based HTTP client, pure utils, timers). Use whenever creating or updating frontend/src/**/*.test.ts(x).
---

# Frontend unit tests (Vitest + React Testing Library)

## Layout & style

- Co-locate: `Foo.tsx` → `Foo.test.tsx`, `foo.ts` → `foo.test.ts` (same directory).
- Prettier style: **no semicolons**, single quotes, trailing commas, 80 columns.
- `environment: jsdom`; `src/test/setup.ts` loads `@testing-library/jest-dom/vitest` and `cleanup`.
- Import `expect, it, vi, describe, beforeEach` explicitly from `'vitest'`.
- Fixture: `import { todoFixture } from '<relative>/test/todoFixture'` — spread to vary
  (`{ ...todoFixture, completed: true }`).
- Run: `bash .github/test-agent/scripts/run-tests.sh test frontend frontend/src/<path>.test.tsx`.

## Querying & interacting

- Prefer `getByRole(role, { name })`, then `getByLabelText`, then `getByText`. `getByTestId('alert')`
  is the established way to find the mocked `Alert`.
- `const user = userEvent.setup()` and `await user.click(...)` / `user.type(...)`.
- Async UI: `await screen.findBy...` or `await waitFor(() => expect(...))`.
- Assert callbacks with `toHaveBeenCalledWith` / `toHaveBeenCalledTimes` and also that the
  *other* callbacks were **not** called.

## Patterns

### Components — mock the design system and child components

```tsx
vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('./TodoItem', () => ({ TodoItem: () => <li>Task</li> }))
```

The mocks render plain HTML (`Button` → `<button>`, `Heading level=3` → `<h3>`,
`Drawer` → `role="dialog"` named by `title`, `Input` → `<label>` + `<input>`). Mock hooks a
component consumes at module level and set return values per test:

```tsx
vi.mock('../hooks/useDeleteTodoMutation', () => ({ useDeleteTodoMutation: vi.fn() }))
vi.mocked(useDeleteTodoMutation).mockReturnValue({
  isPending: false, error: null, mutateAsync,
} as unknown as ReturnType<typeof useDeleteTodoMutation>)
```

Cover: each conditional render branch, disabled/busy states, success *and* rejected `mutateAsync`.

### TanStack Query hooks — real QueryClient, mocked API module

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
vi.mock('../api/todos', () => ({ todosApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() } }))

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}
```

Assert cache effects via `client.getQueryData(todoKeys.list)` after `await result.current.mutateAsync(...)`
(seed with `client.setQueryData(todoKeys.list, [...])`). Wrap in `act` when state updates.
Test files that contain JSX must use the `.test.tsx` extension.

### HTTP client (`src/lib/http.ts`) — stub `fetch`

```ts
const fetchMock = vi.fn()
beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => vi.unstubAllGlobals())
fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: 'Nope' }), { status: 404 }))
```

Cover: success JSON, 204 → `undefined`, 422 → validation message, string `detail`, non-JSON
error body, network failure, aborted request re-throws the original error, headers merge.

### Timers and dates

`vi.useFakeTimers()` + `vi.setSystemTime(new Date('2026-10-10T12:00:00'))`, restore with
`vi.useRealTimers()` in `afterEach`. With `userEvent` + fake timers use
`userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`. For hooks with timeouts use
`act(() => vi.advanceTimersByTime(4000))`.

### Pure utils

Table-driven `it.each`; include boundaries (120/121 chars, invalid calendar dates like
`2026-02-30`), and check inputs are not mutated.

## Do not

- Do not test styled-components CSS or the design system (excluded from coverage).
- Do not render the real `App`/providers when a mock is enough; do not hit `fetch` for real.
- Do not use snapshots for behaviour.
