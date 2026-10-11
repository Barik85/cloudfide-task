import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { TodoStats } from './TodoStats'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-10T12:00:00'))
})
afterEach(() => vi.useRealTimers())

it('renders nothing when there are no tasks', () => {
  const { container } = render(<TodoStats todos={[]} />)
  expect(container).toBeEmptyDOMElement()
})

it('shows counts and completion rate, hiding overdue when none', () => {
  render(
    <TodoStats
      todos={[
        { ...todoFixture, id: 1 },
        { ...todoFixture, id: 2, completed: true },
      ]}
    />,
  )
  const summary = screen.getByRole('region', { name: 'Task summary' })
  expect(summary).toHaveTextContent('1 active')
  expect(summary).toHaveTextContent('1 completed')
  expect(summary).toHaveTextContent('50% done')
  expect(summary).not.toHaveTextContent('overdue')
})

it('shows the overdue count when tasks are overdue', () => {
  render(<TodoStats todos={[{ ...todoFixture, due_date: '2026-10-01' }]} />)
  expect(screen.getByText('1 overdue')).toBeInTheDocument()
})
