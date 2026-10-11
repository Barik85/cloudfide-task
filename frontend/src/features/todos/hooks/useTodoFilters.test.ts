import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useTodoFilters } from './useTodoFilters'

const todos = [
  { ...todoFixture, id: 1, title: 'Write report' },
  { ...todoFixture, id: 2, title: 'Buy milk', completed: true },
]

describe('useTodoFilters', () => {
  it('starts with all todos, empty search and newest sort', () => {
    const { result } = renderHook(() => useTodoFilters(todos))
    expect(result.current.filter).toBe('all')
    expect(result.current.search).toBe('')
    expect(result.current.sort).toBe('newest')
    expect(result.current.visible.map((todo) => todo.id)).toEqual([2, 1])
  })

  it('narrows visible todos by status', () => {
    const { result } = renderHook(() => useTodoFilters(todos))
    act(() => result.current.setFilter('completed'))
    expect(result.current.visible.map((todo) => todo.id)).toEqual([2])
  })

  it('narrows visible todos by search text', () => {
    const { result } = renderHook(() => useTodoFilters(todos))
    act(() => result.current.setSearch('report'))
    expect(result.current.visible.map((todo) => todo.id)).toEqual([1])
  })

  it('updates the sort selection', () => {
    const { result } = renderHook(() => useTodoFilters(todos))
    act(() => result.current.setSort('priority'))
    expect(result.current.sort).toBe('priority')
  })
})
