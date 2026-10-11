import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { summarizeTodos } from './stats'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-10T12:00:00'))
})
afterEach(() => vi.useRealTimers())

it('returns zeros for an empty list', () => {
  expect(summarizeTodos([])).toEqual({
    total: 0,
    active: 0,
    completed: 0,
    overdue: 0,
    completionRate: 0,
  })
})

it('counts active, completed and overdue tasks', () => {
  const todos = [
    { ...todoFixture, id: 1, due_date: '2026-10-09' },
    { ...todoFixture, id: 2, due_date: '2026-10-10' },
    { ...todoFixture, id: 3, completed: true, due_date: '2026-10-01' },
    { ...todoFixture, id: 4, completed: true },
  ]
  expect(summarizeTodos(todos)).toEqual({
    total: 4,
    active: 2,
    completed: 2,
    overdue: 1,
    completionRate: 50,
  })
})

it('rounds the completion rate to a whole percent', () => {
  const todos = [
    { ...todoFixture, id: 1, completed: true },
    { ...todoFixture, id: 2 },
    { ...todoFixture, id: 3 },
  ]
  expect(summarizeTodos(todos).completionRate).toBe(33)
})
