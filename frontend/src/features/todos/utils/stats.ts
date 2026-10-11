import type { Todo } from '../types'
import { isOverdue } from './todos'

export interface TodoStats {
  total: number
  active: number
  completed: number
  overdue: number
  /** Share of completed tasks, rounded to a whole percent (0 when there are no tasks). */
  completionRate: number
}

export function summarizeTodos(todos: Todo[]): TodoStats {
  const completed = todos.filter((todo) => todo.completed).length
  return {
    total: todos.length,
    active: todos.length - completed,
    completed,
    overdue: todos.filter(isOverdue).length,
    completionRate: todos.length
      ? Math.round((completed / todos.length) * 100)
      : 0,
  }
}
