import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatDate, isOverdue, selectTodos, validateTodo } from './todos'
import type { Todo } from '../types'

const base: Todo = {
  id: 1,
  title: 'Sprint plan',
  description: '',
  priority: 'medium',
  completed: false,
  due_date: null,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
}

describe('selectTodos', () => {
  it('combines status with a case-insensitive search in the description', () => {
    const matching = { ...base, description: 'Discuss the API' }
    const todos = [
      matching,
      { ...matching, id: 2, completed: true },
      { ...base, id: 3 },
    ]
    expect(selectTodos(todos, 'active', ' api ', 'newest')).toEqual([matching])
  })

  it('sorts by priority without changing the source array', () => {
    const high: Todo = { ...base, id: 2, priority: 'high' }
    const todos = [base, high]
    expect(selectTodos(todos, 'all', '', 'priority')).toEqual([high, base])
    expect(todos).toEqual([base, high])
  })

  it('sorts by due date with undated tasks last', () => {
    const soon: Todo = { ...base, id: 2, due_date: '2026-10-05' }
    const later: Todo = { ...base, id: 3, due_date: '2026-11-01' }
    expect(selectTodos([base, later, soon], 'all', '', 'due')).toEqual([
      soon,
      later,
      base,
    ])
  })

  it('sorts newest first and filters completed tasks', () => {
    const newer: Todo = {
      ...base,
      id: 2,
      completed: true,
      created_at: '2026-10-02T12:00:00Z',
    }
    expect(selectTodos([base, newer], 'all', '', 'newest')).toEqual([
      newer,
      base,
    ])
    expect(selectTodos([base, newer], 'completed', '', 'newest')).toEqual([
      newer,
    ])
  })
})

describe('validateTodo', () => {
  const valid = {
    title: 'Task',
    description: '',
    priority: 'medium' as const,
    due_date: null,
    completed: false,
  }

  it('accepts a valid task', () => {
    expect(validateTodo(valid)).toEqual({})
  })

  it('requires a non-blank title', () => {
    expect(validateTodo({ ...valid, title: '   ' }).title).toBe(
      'Enter a task title.',
    )
  })

  it('limits the title to 120 characters', () => {
    expect(validateTodo({ ...valid, title: 'a'.repeat(120) })).toEqual({})
    expect(validateTodo({ ...valid, title: 'a'.repeat(121) }).title).toMatch(
      /120/,
    )
  })

  it('limits the description to 2000 characters', () => {
    expect(validateTodo({ ...valid, description: 'a'.repeat(2000) })).toEqual(
      {},
    )
    expect(
      validateTodo({ ...valid, description: 'a'.repeat(2001) }).description,
    ).toMatch(/2000/)
  })

  it.each(['2026-02-30', 'tomorrow', '2026-1-1'])(
    'rejects the invalid due date %s',
    (due_date) => {
      expect(validateTodo({ ...valid, due_date }).due_date).toBe(
        'Enter a valid date.',
      )
    },
  )

  it('accepts a real calendar date', () => {
    expect(validateTodo({ ...valid, due_date: '2028-02-29' })).toEqual({})
  })
})

describe('isOverdue', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is true only for active tasks due before today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-10T12:00:00'))
    expect(isOverdue({ ...base, due_date: '2026-10-09' })).toBe(true)
    expect(isOverdue({ ...base, due_date: '2026-10-10' })).toBe(false)
    expect(isOverdue({ ...base, due_date: null })).toBe(false)
    expect(
      isOverdue({ ...base, due_date: '2026-10-09', completed: true }),
    ).toBe(false)
  })
})

describe('formatDate', () => {
  it('formats an ISO date in en-GB style', () => {
    expect(formatDate('2026-10-05')).toBe('5 Oct 2026')
  })
})
