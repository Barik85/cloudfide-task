import { Badge, Text } from '../../../design-system'
import type { Todo } from '../types'
import { summarizeTodos } from '../utils/stats'

export function TodoStats({ todos }: { todos: Todo[] }) {
  if (!todos.length) return null
  const stats = summarizeTodos(todos)
  return (
    <section className="row compact" aria-label="Task summary">
      <Badge variant="info">{stats.active} active</Badge>
      <Badge variant="success">{stats.completed} completed</Badge>
      {stats.overdue > 0 && (
        <Badge variant="warning">{stats.overdue} overdue</Badge>
      )}
      <Text as="span" muted size="small">
        {stats.completionRate}% done
      </Text>
    </section>
  )
}
