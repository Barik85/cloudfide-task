import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TodoEmptyState } from './TodoEmptyState'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

describe('TodoEmptyState', () => {
  it('invites creating the first task and calls onCreate', async () => {
    const onCreate = vi.fn()
    render(
      <TodoEmptyState hasTodos={false} disabled={false} onCreate={onCreate} />,
    )
    expect(
      screen.getByRole('heading', { name: 'Add your first task' }),
    ).toBeInTheDocument()
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Add your first task' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('disables the create button when disabled', () => {
    render(<TodoEmptyState hasTodos={false} disabled onCreate={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: 'Add your first task' }),
    ).toBeDisabled()
  })

  it('shows a no-match message without a create button when todos exist', () => {
    render(<TodoEmptyState hasTodos disabled={false} onCreate={vi.fn()} />)
    expect(
      screen.getByRole('heading', { name: 'No matching tasks' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
