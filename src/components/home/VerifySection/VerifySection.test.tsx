import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '../../../__tests__/test-utils'
import VerifySection from './VerifySection'
import type { UseVerifyReturn } from './useVerify'
import { TYPES } from './verifyErrorUtils'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

// Mock NetworkModal to avoid VITE_NETWORK_TYPE env dependency
vi.mock('./NetworkModal', () => ({
  default: ({ fileName }: { fileName: string }) => (
    <div data-testid="network-modal">{fileName}</div>
  ),
}))

vi.mock('./useVerify', () => ({ useVerify: vi.fn() }))

import { useVerify } from './useVerify'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const defaultHook: UseVerifyReturn = {
  verifyStatus: 'idle',
  fileName: '',
  errorType: TYPES.VERIFICATION_ERROR,
  dragActive: false,
  isTransferable: false,
  isExpired: false,
  tokenRegistryVersion: null,
  tags: [],
  carrier: null,
  getGroupStatus: vi.fn().mockReturnValue('VALID' as const),
  handleDrag: vi.fn(),
  handleDrop: vi.fn(),
  handleFileInput: vi.fn(),
  handleReset: vi.fn(),
  handleNetworkConfirm: vi.fn(),
  handleNetworkCancel: vi.fn(),
  loadDocument: vi.fn(),
}

const setStatus = (overrides: Partial<UseVerifyReturn>) => {
  vi.mocked(useVerify).mockReturnValue({ ...defaultHook, ...overrides })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('VerifySection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setStatus({})
  })

  // ── Idle ───────────────────────────────────────────────────────────────────

  describe('idle state', () => {
    it('renders the dropzone text', () => {
      render(<VerifySection isDarkMode={false} />)
      expect(
        screen.getByText(/Drop TrustVC files here to verify/i)
      ).toBeInTheDocument()
    })

    it('renders the Browse Files button', () => {
      render(<VerifySection isDarkMode={false} />)
      expect(screen.getByText(/Browse Files/i)).toBeInTheDocument()
    })

    it('does not render the spinner or result', () => {
      render(<VerifySection isDarkMode={false} />)
      expect(screen.queryByText(/Verifying/i)).not.toBeInTheDocument()
      expect(screen.queryByText('Document Verified')).not.toBeInTheDocument()
    })
  })

  // ── Verifying ──────────────────────────────────────────────────────────────

  describe('verifying state', () => {
    it('shows spinner with the fileName', () => {
      setStatus({ verifyStatus: 'verifying', fileName: 'doc.tt' })
      render(<VerifySection isDarkMode={false} />)
      expect(screen.getByText('Verifying doc.tt...')).toBeInTheDocument()
    })

    it('does not show the dropzone', () => {
      setStatus({ verifyStatus: 'verifying', fileName: 'doc.tt' })
      render(<VerifySection isDarkMode={false} />)
      expect(
        screen.queryByText(/Drop TrustVC files here to verify/i)
      ).not.toBeInTheDocument()
    })
  })

  // ── Valid ──────────────────────────────────────────────────────────────────

  describe('valid state', () => {
    it('renders VerifyResult with the fileName', () => {
      setStatus({ verifyStatus: 'valid', fileName: 'valid-doc.tt' })
      render(<VerifySection isDarkMode={false} />)
      expect(
        screen.getByRole('button', { name: /upload new file/i })
      ).toBeInTheDocument()
      expect(screen.getByText('valid-doc.tt')).toBeInTheDocument()
    })

    it('does not render VerifyError', () => {
      setStatus({ verifyStatus: 'valid' })
      render(<VerifySection isDarkMode={false} />)
      expect(screen.queryByTestId('error-message')).not.toBeInTheDocument()
    })
  })

  // ── Invalid ────────────────────────────────────────────────────────────────

  describe('invalid state', () => {
    it('renders VerifyError instead of VerifyResult', () => {
      setStatus({
        verifyStatus: 'invalid',
        errorType: TYPES.VERIFICATION_ERROR,
      })
      render(<VerifySection isDarkMode={false} />)
      expect(screen.queryByText('Document Verified')).not.toBeInTheDocument()
      expect(screen.getByTestId('error-message')).toBeInTheDocument()
    })

    it('shows verification error for generic failures', () => {
      setStatus({
        verifyStatus: 'invalid',
        errorType: TYPES.VERIFICATION_ERROR,
      })
      render(<VerifySection isDarkMode={false} />)
      expect(screen.getByTestId('error-message').textContent).toBe(
        'Document Verification Failed'
      )
    })

    it('renders tampered error for tampered documents', () => {
      setStatus({
        verifyStatus: 'invalid',
        errorType: TYPES.HASH,
      })
      render(<VerifySection isDarkMode={false} />)
      expect(screen.getByTestId('error-message').textContent).toBe(
        'Document has been tampered with'
      )
    })

    it('renders revoked error for revoked documents', () => {
      setStatus({
        verifyStatus: 'invalid',
        errorType: TYPES.REVOKED,
      })
      render(<VerifySection isDarkMode={false} />)
      expect(screen.getByTestId('error-message').textContent).toBe(
        'Document revoked'
      )
    })

    it('renders not issued error for unissued documents', () => {
      setStatus({
        verifyStatus: 'invalid',
        errorType: TYPES.ISSUED,
      })
      render(<VerifySection isDarkMode={false} />)
      expect(screen.getByTestId('error-message').textContent).toBe(
        'Document not issued'
      )
    })

    it('renders issuer identity error for invalid issuer', () => {
      setStatus({
        verifyStatus: 'invalid',
        errorType: TYPES.IDENTITY,
      })
      render(<VerifySection isDarkMode={false} />)
      expect(screen.getByTestId('error-message').textContent).toBe(
        'Document issuer identity is invalid'
      )
    })
  })

  // ── Error ──────────────────────────────────────────────────────────────────

  describe('error state', () => {
    it('renders verification error for parse errors', () => {
      setStatus({
        verifyStatus: 'error',
        errorType: TYPES.VERIFICATION_ERROR,
      })
      render(<VerifySection isDarkMode={false} />)
      expect(screen.getByTestId('error-message').textContent).toBe(
        'Document Verification Failed'
      )
    })

    it('renders network invalid error', () => {
      setStatus({
        verifyStatus: 'error',
        errorType: TYPES.NETWORK_INVALID,
      })
      render(<VerifySection isDarkMode={false} />)
      expect(screen.getByTestId('error-message').textContent).toBe(
        "Document's network field is invalid"
      )
    })

    it('renders contract not found error', () => {
      setStatus({
        verifyStatus: 'error',
        errorType: TYPES.CONTRACT_NOT_FOUND,
      })
      render(<VerifySection isDarkMode={false} />)
      expect(screen.getByTestId('error-message').textContent).toBe(
        'Document store or Token registry address cannot be found'
      )
    })

    it('renders server error', () => {
      setStatus({
        verifyStatus: 'error',
        errorType: TYPES.SERVER_ERROR,
      })
      render(<VerifySection isDarkMode={false} />)
      expect(screen.getByTestId('error-message').textContent).toBe(
        'Unable to connect to the blockchain network'
      )
    })

    it('renders Try Another Document button', () => {
      setStatus({
        verifyStatus: 'error',
        errorType: TYPES.VERIFICATION_ERROR,
      })
      render(<VerifySection isDarkMode={false} />)
      expect(screen.getByTestId('try-another-btn')).toBeInTheDocument()
    })
  })

  // ── Network select ─────────────────────────────────────────────────────────

  describe('network-select state', () => {
    it('renders the dropzone and the NetworkModal', () => {
      setStatus({ verifyStatus: 'network-select', fileName: 'pending.tt' })
      render(<VerifySection isDarkMode={false} />)
      expect(
        screen.getByText(/Drop TrustVC files here to verify/i)
      ).toBeInTheDocument()
      expect(screen.getByTestId('network-modal')).toBeInTheDocument()
    })

    it('passes the fileName to NetworkModal', () => {
      setStatus({ verifyStatus: 'network-select', fileName: 'pending.tt' })
      render(<VerifySection isDarkMode={false} />)
      expect(screen.getByTestId('network-modal').textContent).toBe('pending.tt')
    })
  })

  // ── Dark mode ──────────────────────────────────────────────────────────────

  describe('dark mode', () => {
    it('applies dark-mode class when isDarkMode is true', () => {
      const { container } = render(<VerifySection isDarkMode={true} />)
      expect(container.querySelector('.verify-section')).toHaveClass(
        'dark-mode'
      )
    })

    it('does not apply dark-mode class when isDarkMode is false', () => {
      const { container } = render(<VerifySection isDarkMode={false} />)
      expect(container.querySelector('.verify-section')).not.toHaveClass(
        'dark-mode'
      )
    })
  })

  // ── Demo section ───────────────────────────────────────────────────────────

  describe('demo section', () => {
    it('renders the demo heading and description', () => {
      render(<VerifySection isDarkMode={false} />)
      expect(screen.getByText(/Try our demo document!/i)).toBeInTheDocument()
      expect(
        screen.getByText(/Experience the interoperability of our documents/i)
      ).toBeInTheDocument()
    })

    it('opens the document gallery in a new tab when clicked', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
      render(<VerifySection isDarkMode={false} />)
      const ctaButton = screen
        .getByText(/Visit Document Gallery/i)
        .closest('.cta-button')
      fireEvent.click(ctaButton as HTMLElement)
      expect(openSpy).toHaveBeenCalledWith(
        'https://gallery.tradetrust.io',
        '_blank',
        'noopener,noreferrer'
      )
      openSpy.mockRestore()
    })
  })
})
