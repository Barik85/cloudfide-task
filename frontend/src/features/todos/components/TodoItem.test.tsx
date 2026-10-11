import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { TodoItem } from './TodoItem'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

const noop = { onEdit: vi.fn(), onToggle: vi.fn(), onDelete: vi.fn() }

it('shows a completed task with description and forwards toggle and delete', async () => {
  const user = userEvent.setup()
  const onToggle = vi.fn()
  const onDelete = vi.fn()
  const todo = { ...todoFixture, completed: true, description: 'Some notes' }
  render(
    <TodoItem
      todo={todo}
      busy={false}
      onEdit={vi.fn()}
      onToggle={onToggle}
      onDelete={onDelete}
    />,
  )
  expect(screen.getByText('Completed')).toBeVisible()
  expect(screen.getByText('Some notes')).toBeVisible()
  expect(screen.getByRole('checkbox')).toBeChecked()
  await user.click(
    screen.getByRole('checkbox', { name: `Mark as active: ${todo.title}` }),
  )
  await user.click(
    screen.getByRole('button', { name: `Delete: ${todo.title}` }),
  )
  expect(onToggle).toHaveBeenCalledTimes(1)
  expect(onDelete).toHaveBeenCalledTimes(1)
})

it('marks an incomplete task past its due date as overdue', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-10T12:00:00'))
  try {
    render(
      <TodoItem
        todo={{ ...todoFixture, due_date: '2026-10-01' }}
        busy={false}
        {...noop}
      />,
    )
    expect(screen.getByText(/overdue/)).toBeVisible()
  } finally {
    vi.useRealTimers()
  }
})

it('does not mark a completed or future task as overdue', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-10T12:00:00'))
  try {
    const { rerender } = render(
      <TodoItem
        todo={{ ...todoFixture, due_date: '2026-10-01', completed: true }}
        busy={false}
        {...noop}
      />,
    )
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
    rerender(
      <TodoItem
        todo={{ ...todoFixture, due_date: '2026-10-30' }}
        busy={false}
        {...noop}
      />,
    )
    expect(screen.getByText(/30 Oct 2026/)).toBeVisible()
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})

it('disables all actions while busy', () => {
  render(<TodoItem todo={todoFixture} busy {...noop} />)
  expect(screen.getByRole('checkbox')).toBeDisabled()
  expect(
    screen.getByRole('button', { name: `Edit: ${todoFixture.title}` }),
  ).toBeDisabled()
  expect(
    screen.getByRole('button', { name: `Delete: ${todoFixture.title}` }),
  ).toBeDisabled()
})

it('shows an active task and forwards edit requests', async () => {
  const user = userEvent.setup()
  const onEdit = vi.fn()
  const onToggle = vi.fn()
  const onDelete = vi.fn()
  render(
    <TodoItem
      todo={todoFixture}
      busy={false}
      onEdit={onEdit}
      onToggle={onToggle}
      onDelete={onDelete}
    />,
  )
  expect(screen.getByRole('heading', { name: todoFixture.title })).toBeVisible()
  expect(screen.getByText('To do')).toBeVisible()
  expect(screen.getByText('Medium')).toBeVisible()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  await user.click(
    screen.getByRole('button', { name: `Edit: ${todoFixture.title}` }),
  )
  expect(onEdit).toHaveBeenCalledTimes(1)
  expect(onToggle).not.toHaveBeenCalled()
  expect(onDelete).not.toHaveBeenCalled()
})
