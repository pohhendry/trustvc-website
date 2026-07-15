import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '../../__tests__/test-utils'
import MinimalVerifierApp from './MinimalVerifierApp'

vi.mock('../home/VerifySection', () => ({
  default: (props: { isDarkMode: boolean; showDemoCta?: boolean }) => (
    <div
      data-testid="verify-section-mock"
      data-is-dark-mode={String(props.isDarkMode)}
      data-show-demo-cta={String(props.showDemoCta)}
    />
  ),
}))

describe('MinimalVerifierApp', () => {
  beforeEach(() => {
    document.title = ''
  })

  afterEach(() => {
    document.head
      .querySelectorAll("link[rel~='icon']")
      .forEach(el => el.remove())
  })

  it('sets the page title on mount', () => {
    render(<MinimalVerifierApp />)
    expect(document.title).toBe('Doc Verifier · Dev Build')
  })

  it('sets a favicon distinct from the default TrustVC favicon', () => {
    render(<MinimalVerifierApp />)
    const link = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
    expect(link).not.toBeNull()
    expect(link?.href).toMatch(/^data:image\/svg\+xml/)
  })

  it('renders the development-only banner', () => {
    render(<MinimalVerifierApp />)
    expect(
      screen.getByText(
        /Development Build — internal testing only\. Not affiliated with trustvc\.io\./i
      )
    ).toBeInTheDocument()
  })

  it('renders the placeholder wordmark, not the TrustVC name alone', () => {
    render(<MinimalVerifierApp />)
    expect(screen.getByText(/Doc Verifier/i)).toBeInTheDocument()
    expect(screen.getByText(/Dev Build/i)).toBeInTheDocument()
  })

  it('renders VerifySection with the demo CTA disabled', () => {
    render(<MinimalVerifierApp />)
    const mock = screen.getByTestId('verify-section-mock')
    expect(mock.dataset.showDemoCta).toBe('false')
    expect(mock.dataset.isDarkMode).toBe('false')
  })
})
