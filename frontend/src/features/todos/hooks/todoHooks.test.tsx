import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useCreateTodoMutation } from './useCreateTodoMutation'
import { useDeleteTodoMutation } from './useDeleteTodoMutation'
import { useTodosBusy } from './useTodosBusy'
import { useTodosQuery } from './useTodosQuery'
import { useUpdateTodoMutation } from './useUpdateTodoMutation'

vi.mock('../api/todos', () => ({
  todosApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

const other = { ...todoFixture, id: 8, title: 'Other' }

beforeEach(() => {
  vi.resetAllMocks()
})

describe('useTodosQuery', () => {
  it('loads todos and passes the abort signal to the API', async () => {
    vi.mocked(todosApi.list).mockResolvedValue([todoFixture])
    const { wrapper } = setup()
    const { result } = renderHook(() => useTodosQuery(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual([todoFixture]))
    expect(todosApi.list).toHaveBeenCalledWith(expect.any(AbortSignal))
  })

  it('exposes the error when loading fails', async () => {
    vi.mocked(todosApi.list).mockRejectedValue(new Error('boom'))
    const { wrapper } = setup()
    const { result } = renderHook(() => useTodosQuery(), { wrapper })
    await waitFor(() => expect(result.current.error?.message).toBe('boom'))
  })
})

describe('useCreateTodoMutation', () => {
  it('prepends the saved todo to the cached list', async () => {
    const { client, wrapper } = setup()
    client.setQueryData(todoKeys.list, [other])
    vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
    const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
    await result.current.mutateAsync({
      title: 'x',
      description: '',
      priority: 'medium',
      due_date: null,
      completed: false,
    })
    expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture, other])
  })

  it('creates the list when nothing is cached and avoids duplicates', async () => {
    const { client, wrapper } = setup()
    vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
    const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
    const input = {
      title: 'x',
      description: '',
      priority: 'medium' as const,
      due_date: null,
      completed: false,
    }
    await result.current.mutateAsync(input)
    await result.current.mutateAsync(input)
    expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
  })

  it('keeps the cache unchanged when creation fails', async () => {
    const { client, wrapper } = setup()
    client.setQueryData(todoKeys.list, [other])
    vi.mocked(todosApi.create).mockRejectedValue(new Error('nope'))
    const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
    await expect(
      result.current.mutateAsync({
        title: 'x',
        description: '',
        priority: 'medium',
        due_date: null,
        completed: false,
      }),
    ).rejects.toThrow('nope')
    expect(client.getQueryData(todoKeys.list)).toEqual([other])
  })
})

describe('useUpdateTodoMutation', () => {
  it('replaces the updated todo in the cached list', async () => {
    const { client, wrapper } = setup()
    client.setQueryData(todoKeys.list, [todoFixture, other])
    const saved = { ...todoFixture, completed: true }
    vi.mocked(todosApi.update).mockResolvedValue(saved)
    const { result } = renderHook(() => useUpdateTodoMutation(), { wrapper })
    await result.current.mutateAsync({ id: 7, input: { completed: true } })
    expect(todosApi.update).toHaveBeenCalledWith(7, { completed: true })
    expect(client.getQueryData(todoKeys.list)).toEqual([saved, other])
  })

  it('does not create a list when none is cached', async () => {
    const { client, wrapper } = setup()
    vi.mocked(todosApi.update).mockResolvedValue(todoFixture)
    const { result } = renderHook(() => useUpdateTodoMutation(), { wrapper })
    await result.current.mutateAsync({ id: 7, input: {} })
    expect(client.getQueryData(todoKeys.list)).toBeUndefined()
  })
})

describe('useDeleteTodoMutation', () => {
  it('removes the deleted todo from the cached list', async () => {
    const { client, wrapper } = setup()
    client.setQueryData(todoKeys.list, [todoFixture, other])
    vi.mocked(todosApi.remove).mockResolvedValue(undefined)
    const { result } = renderHook(() => useDeleteTodoMutation(), { wrapper })
    await result.current.mutateAsync(7)
    expect(todosApi.remove).toHaveBeenCalledWith(7)
    expect(client.getQueryData(todoKeys.list)).toEqual([other])
  })

  it('keeps the cache unchanged when deletion fails', async () => {
    const { client, wrapper } = setup()
    client.setQueryData(todoKeys.list, [todoFixture])
    vi.mocked(todosApi.remove).mockRejectedValue(new Error('nope'))
    const { result } = renderHook(() => useDeleteTodoMutation(), { wrapper })
    await expect(result.current.mutateAsync(7)).rejects.toThrow('nope')
    expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
  })
})

describe('useTodosBusy', () => {
  it('is true only while a todo mutation is in flight', async () => {
    const { wrapper } = setup()
    let resolve!: (todo: typeof todoFixture) => void
    vi.mocked(todosApi.update).mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )
    const { result } = renderHook(
      () => ({ busy: useTodosBusy(), update: useUpdateTodoMutation() }),
      { wrapper },
    )
    expect(result.current.busy).toBe(false)
    result.current.update.mutate({ id: 7, input: {} })
    await waitFor(() => expect(result.current.busy).toBe(true))
    resolve(todoFixture)
    await waitFor(() => expect(result.current.busy).toBe(false))
  })
})
