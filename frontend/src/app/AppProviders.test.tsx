import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { AppProviders } from './AppProviders'

vi.mock('../design-system', () => ({
  GlobalStyles: () => null,
  theme: {},
}))

function ClientProbe({ onClient }: { onClient: (c: QueryClient) => void }) {
  onClient(useQueryClient())
  return <p>child</p>
}

it('renders children and provides the given query client', () => {
  const client = new QueryClient()
  const onClient = vi.fn()
  render(
    <AppProviders client={client}>
      <ClientProbe onClient={onClient} />
    </AppProviders>,
  )
  expect(screen.getByText('child')).toBeVisible()
  expect(onClient).toHaveBeenCalledWith(client)
})

it('falls back to the shared query client by default', () => {
  const onClient = vi.fn()
  render(
    <AppProviders>
      <ClientProbe onClient={onClient} />
    </AppProviders>,
  )
  expect(onClient.mock.calls[0][0]).toBeInstanceOf(QueryClient)
})
