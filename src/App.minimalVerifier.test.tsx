import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from './__tests__/test-utils'

vi.mock('./components/minimal-verifier', () => ({
  default: () => <div data-testid="minimal-verifier-app-mock" />,
}))

describe('App — VITE_MINIMAL_VERIFIER flag', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_MINIMAL_VERIFIER', 'true')
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('renders MinimalVerifierApp instead of Navbar/AppRouter when the flag is set', async () => {
    const { default: App } = await import('./App')
    render(<App />)

    expect(screen.getByTestId('minimal-verifier-app-mock')).toBeInTheDocument()
    expect(screen.queryByText('Partners')).not.toBeInTheDocument()
    expect(screen.queryByText('News & Updates')).not.toBeInTheDocument()
  })
})
