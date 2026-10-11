import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { request } from './http'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

describe('request', () => {
  it('returns parsed JSON and prefixes the path with /api', async () => {
    fetchMock.mockResolvedValue(json([{ id: 1 }]))
    await expect(request('/todos')).resolves.toEqual([{ id: 1 }])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/todos',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  it('merges custom headers over the defaults', async () => {
    fetchMock.mockResolvedValue(json({}))
    await request('/todos', { headers: { 'X-Test': '1' } })
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
      'X-Test': '1',
    })
  })

  it('returns undefined for a 204 response', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(request('/todos/1')).resolves.toBeUndefined()
  })

  it('shows a validation message for a 422 response', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'ignored' }, 422))
    await expect(request('/todos')).rejects.toThrow(/Check the task details/)
  })

  it('uses a string detail from the error body', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'Task not found' }, 404))
    await expect(request('/todos/9')).rejects.toThrow('Task not found')
  })

  it('falls back to a generic message for a non-string detail', async () => {
    fetchMock.mockResolvedValue(json({ detail: [1] }, 500))
    await expect(request('/todos')).rejects.toThrow(
      'The operation failed. Please try again.',
    )
  })

  it('falls back to a generic message for a non-JSON error body', async () => {
    fetchMock.mockResolvedValue(new Response('oops', { status: 500 }))
    await expect(request('/todos')).rejects.toThrow(
      'The operation failed. Please try again.',
    )
  })

  it('reports a connection problem when fetch fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(request('/todos')).rejects.toThrow(
      'Cannot connect to the server. Please try again.',
    )
  })

  it('rethrows the original error when the request was aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const abortError = new DOMException('Aborted', 'AbortError')
    fetchMock.mockRejectedValue(abortError)
    await expect(request('/todos', { signal: controller.signal })).rejects.toBe(
      abortError,
    )
  })
})
