import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import {
  useVerify,
  makeExplorerAddressURL,
  getErrorTypeFromFragments,
  getErrorMessageFromFragments,
} from './useVerify'
import { TYPES } from './verifyErrorUtils'
import { DocumentProvider } from '../../common/contexts/DocumentContext'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../../lib/sentry', () => ({
  captureVerificationBreadcrumb: vi.fn(),
  captureVerificationException: vi.fn(),
  captureVerificationInvalid: vi.fn(),
  isSentryEnabled: vi.fn(() => false),
  initSentry: vi.fn(),
}))

vi.mock('../../../utils/analytics', () => ({
  trackDocumentDropped: vi.fn(),
  trackDocumentVerified: vi.fn(),
  trackDocumentVerifyError: vi.fn(),
  trackNetworkSelectionShown: vi.fn(),
  trackNetworkSelected: vi.fn(),
  trackNetworkSelectionCancelled: vi.fn(),
  trackVerificationReset: vi.fn(),
}))

// Mock import.meta.env
Object.defineProperty(import.meta, 'env', {
  value: {
    VITE_RPC_URL_1: 'https://eth-mainnet.example.com',
    VITE_RPC_URL_137: 'https://polygon.example.com',
  },
  writable: true,
})

// Polyfill File.prototype.text for test environment
if (!File.prototype.text) {
  File.prototype.text = function () {
    return new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsText(this)
    })
  }
}

// Polyfill File.prototype.arrayBuffer for the test environment — processFile now
// reads the raw bytes (to sniff for the PDF magic header) before deciding between
// the JSON and Verifiable-PDF paths. jsdom's File lacks this; real browsers have it.
if (!File.prototype.arrayBuffer) {
  File.prototype.arrayBuffer = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
}

vi.mock('@trustvc/trustvc', async importOriginal => {
  const actual = await importOriginal<typeof import('@trustvc/trustvc')>()

  // Create mock chain info with all required properties
  const createMockChainInfo = (
    id: string,
    name: string,
    rpcUrl: string,
    explorerUrl: string
  ) => ({
    id,
    name,
    label: name,
    rpcUrl,
    explorerUrl,
    type: 'production' as const,
    currency: 'ETH',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  })
  return {
    ...actual,
    verifyDocument: vi.fn(),
    getChainId: vi.fn(),
    isTransferableRecord: vi.fn(),
    isDocumentRevokable: vi.fn(),
    SUPPORTED_CHAINS: {
      '1': createMockChainInfo(
        '1',
        'homestead',
        'https://eth-mainnet.example.com',
        'https://etherscan.io'
      ),
      '137': createMockChainInfo(
        '137',
        'matic',
        'https://polygon.example.com',
        'https://polygonscan.com'
      ),
      '50': createMockChainInfo(
        '50',
        'xdc',
        'https://xdc-rpc.com',
        'https://xdc-explorer.io'
      ),
      '101010': createMockChainInfo(
        '101010',
        'stability',
        'https://stability-rpc.com',
        'https://stability-explorer.io'
      ),
      '1338': createMockChainInfo(
        '1338',
        'astron',
        'https://astron-rpc.com',
        'https://astron-explorer.io'
      ),
      '11155111': createMockChainInfo(
        '11155111',
        'sepolia',
        'https://sepolia-rpc.com',
        'https://sepolia-explorer.io'
      ),
      '80002': createMockChainInfo(
        '80002',
        'amoy',
        'https://amoy-rpc.com',
        'https://amoy-explorer.io'
      ),
      '51': createMockChainInfo(
        '51',
        'xdcapothem',
        'https://apothem-rpc.com',
        'https://apothem-explorer.io'
      ),
      '20180427': createMockChainInfo(
        '20180427',
        'stabilitytestnet',
        'https://stability-test-rpc.com',
        'https://stability-test-explorer.io'
      ),
      '21002': createMockChainInfo(
        '21002',
        'astrontestnet',
        'https://astron-test-rpc.com',
        'https://astron-test-explorer.io'
      ),
    },
    // Document type predicates used in getIssuerName / getDocumentTags
    isWrappedV2Document: vi.fn().mockReturnValue(false),
    isWrappedV3Document: vi.fn().mockReturnValue(false),
    isRawV2Document: vi.fn().mockReturnValue(false),
    isSignedWrappedV2Document: vi.fn().mockReturnValue(false),
    isRawV3Document: vi.fn().mockReturnValue(false),
    isSignedWrappedV3Document: vi.fn().mockReturnValue(false),
    // Title escrow helpers used in detectTokenRegistryVersion
    isTitleEscrowVersion: vi.fn().mockResolvedValue(false),
    TitleEscrowInterface: { V4: 'V4', V5: 'V5' },
    getTokenRegistryAddress: vi.fn().mockReturnValue(undefined),
    getTokenId: vi.fn().mockReturnValue(undefined),
    getDocumentData: vi.fn().mockReturnValue({ id: 'test-key-id' }),
    // Namespace objects (only methods used in the source are stubbed)
    utils: {},
    v2: {},
    v3: {},
    vc: {
      isSignedDocument: vi.fn().mockReturnValue(false),
      isRawDocument: vi.fn().mockReturnValue(false),
      isSignedDocumentV2_0: vi.fn().mockReturnValue(false),
    },
  }
})

import {
  verifyDocument,
  getChainId,
  isTransferableRecord,
  isDocumentRevokable,
  isWrappedV2Document,
  getDocumentData,
} from '@trustvc/trustvc'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeFile = (content: object, name = 'doc.tt') =>
  new File([JSON.stringify(content)], name, { type: 'application/json' })

const makeDragEvent = (type: string, files: File[] = []) =>
  ({
    type,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: { files },
  }) as unknown as React.DragEvent

const triggerFileInput = (
  result: ReturnType<
    typeof renderHook<ReturnType<typeof useVerify>, unknown>
  >['result'],
  file: File
) => {
  result.current.handleFileInput({
    target: { files: [file], value: '' },
  } as unknown as React.ChangeEvent<HTMLInputElement>)
}

// Wrapper to provide DocumentContext to the hook
const wrapper = ({ children }: { children: React.ReactNode }) => {
  return React.createElement(DocumentProvider, null, children)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useVerify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  // ── Initial state ──────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('starts idle with empty fields', () => {
      const { result } = renderHook(() => useVerify(), { wrapper })
      expect(result.current.verifyStatus).toBe('idle')
      expect(result.current.fileName).toBe('')
      expect(result.current.errorType).toBe(TYPES.VERIFICATION_ERROR)
      expect(result.current.dragActive).toBe(false)
    })
  })

  // ── handleReset ────────────────────────────────────────────────────────────

  describe('handleReset', () => {
    it('resets all state back to initial values', async () => {
      vi.mocked(verifyDocument).mockResolvedValue([
        {
          name: 'OpenAttestationHash',
          status: 'VALID',
          type: 'DOCUMENT_INTEGRITY',
        },
      ])
      vi.mocked(getChainId).mockReturnValue('1' as any)
      vi.mocked(isTransferableRecord).mockReturnValue(false)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)

      const { result } = renderHook(() => useVerify(), { wrapper })

      await act(async () => {
        triggerFileInput(result, makeFile({ test: true }))
      })
      await waitFor(() => expect(result.current.verifyStatus).toBe('valid'))

      act(() => {
        result.current.handleReset()
      })

      expect(result.current.verifyStatus).toBe('idle')
      expect(result.current.fileName).toBe('')
      expect(result.current.errorType).toBe(TYPES.VERIFICATION_ERROR)
      expect(result.current.dragActive).toBe(false)
    })
  })

  // ── handleDrag ─────────────────────────────────────────────────────────────

  describe('handleDrag', () => {
    it('sets dragActive true on dragenter', () => {
      const { result } = renderHook(() => useVerify(), { wrapper })
      act(() => {
        result.current.handleDrag(makeDragEvent('dragenter'))
      })
      expect(result.current.dragActive).toBe(true)
    })

    it('sets dragActive true on dragover', () => {
      const { result } = renderHook(() => useVerify(), { wrapper })
      act(() => {
        result.current.handleDrag(makeDragEvent('dragover'))
      })
      expect(result.current.dragActive).toBe(true)
    })

    it('sets dragActive false on dragleave', () => {
      const { result } = renderHook(() => useVerify(), { wrapper })
      act(() => {
        result.current.handleDrag(makeDragEvent('dragenter'))
      })
      act(() => {
        result.current.handleDrag(makeDragEvent('dragleave'))
      })
      expect(result.current.dragActive).toBe(false)
    })

    it('calls preventDefault and stopPropagation', () => {
      const { result } = renderHook(() => useVerify(), { wrapper })
      const event = makeDragEvent('dragenter')
      act(() => {
        result.current.handleDrag(event)
      })
      expect(event.preventDefault).toHaveBeenCalled()
      expect(event.stopPropagation).toHaveBeenCalled()
    })
  })

  // ── handleFileInput ────────────────────────────────────────────────────────

  describe('handleFileInput', () => {
    it('does nothing when no file is provided', () => {
      const { result } = renderHook(() => useVerify(), { wrapper })
      act(() => {
        result.current.handleFileInput({
          target: { files: null, value: '' },
        } as unknown as React.ChangeEvent<HTMLInputElement>)
      })
      expect(result.current.verifyStatus).toBe('idle')
    })

    it('sets fileName immediately', async () => {
      vi.mocked(verifyDocument).mockResolvedValue([])
      vi.mocked(getChainId).mockReturnValue('1' as any)
      vi.mocked(isTransferableRecord).mockReturnValue(false)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)

      const { result } = renderHook(() => useVerify(), { wrapper })
      await act(async () => {
        triggerFileInput(result, makeFile({ test: true }, 'my-doc.tt'))
      })
      expect(result.current.fileName).toBe('my-doc.tt')
    })

    it('resolves to valid when all fragment groups are VALID', async () => {
      vi.mocked(verifyDocument).mockResolvedValue([
        {
          name: 'OpenAttestationHash',
          status: 'VALID',
          type: 'DOCUMENT_INTEGRITY',
        },
        {
          name: 'OpenAttestationEthereumDocumentStoreStatus',
          status: 'VALID',
          type: 'DOCUMENT_STATUS',
        },
      ])
      vi.mocked(getChainId).mockReturnValue('1' as any)
      vi.mocked(isTransferableRecord).mockReturnValue(false)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)

      const { result } = renderHook(() => useVerify(), { wrapper })
      await act(async () => {
        triggerFileInput(result, makeFile({ test: true }))
      })
      await waitFor(() => expect(result.current.verifyStatus).toBe('valid'))
    })

    it('resolves to invalid when any fragment group has INVALID status', async () => {
      vi.mocked(verifyDocument).mockResolvedValue([
        {
          name: 'OpenAttestationHash',
          status: 'VALID',
          type: 'DOCUMENT_INTEGRITY',
        },
        {
          name: 'OpenAttestationEthereumDocumentStoreStatus',
          status: 'INVALID',
          type: 'DOCUMENT_STATUS',
        },
      ])
      vi.mocked(getChainId).mockReturnValue('1' as any)
      vi.mocked(isTransferableRecord).mockReturnValue(false)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)

      const { result } = renderHook(() => useVerify(), { wrapper })
      await act(async () => {
        triggerFileInput(result, makeFile({ test: true }))
      })
      await waitFor(() => expect(result.current.verifyStatus).toBe('invalid'))
    })

    it('resolves to invalid when no fragments are returned', async () => {
      vi.mocked(verifyDocument).mockResolvedValue([])
      vi.mocked(getChainId).mockReturnValue('1' as any)
      vi.mocked(isTransferableRecord).mockReturnValue(false)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)

      const { result } = renderHook(() => useVerify(), { wrapper })
      await act(async () => {
        triggerFileInput(result, makeFile({ test: true }))
      })
      await waitFor(() => expect(result.current.verifyStatus).toBe('invalid'))
    })

    it('sets error with SyntaxError message on invalid JSON', async () => {
      const { result } = renderHook(() => useVerify(), { wrapper })
      const badFile = new File(['not { valid json'], 'bad.tt', {
        type: 'text/plain',
      })
      await act(async () => {
        triggerFileInput(result, badFile)
      })
      await waitFor(() => expect(result.current.verifyStatus).toBe('error'))
      expect(result.current.errorType).toBe(TYPES.INVALID)
    })

    it('sets error with the thrown Error message when verifyDocument rejects', async () => {
      vi.mocked(verifyDocument).mockRejectedValue(new Error('RPC unavailable'))
      vi.mocked(getChainId).mockReturnValue('1' as any)
      vi.mocked(isTransferableRecord).mockReturnValue(false)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)

      const { result } = renderHook(() => useVerify(), { wrapper })
      await act(async () => {
        triggerFileInput(result, makeFile({ test: true }))
      })
      await waitFor(() => expect(result.current.verifyStatus).toBe('error'))
      expect(result.current.errorType).toBe(TYPES.VERIFICATION_ERROR)
    })

    it('sets error with fallback message for non-Error throws', async () => {
      vi.mocked(verifyDocument).mockRejectedValue('something weird')
      vi.mocked(getChainId).mockReturnValue('1' as any)
      vi.mocked(isTransferableRecord).mockReturnValue(false)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)

      const { result } = renderHook(() => useVerify(), { wrapper })
      await act(async () => {
        triggerFileInput(result, makeFile({ test: true }))
      })
      await waitFor(() => expect(result.current.verifyStatus).toBe('error'))
      expect(result.current.errorType).toBe(TYPES.VERIFICATION_ERROR)
    })

    it('transitions to network-select for a transferable record with no chainId', async () => {
      vi.mocked(getChainId).mockReturnValue(null as any)
      vi.mocked(isTransferableRecord).mockReturnValue(true)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)

      const { result } = renderHook(() => useVerify(), { wrapper })
      await act(async () => {
        triggerFileInput(result, makeFile({ test: true }, 'tr.tt'))
      })
      await waitFor(() =>
        expect(result.current.verifyStatus).toBe('network-select')
      )
      expect(result.current.fileName).toBe('tr.tt')
    })

    it('transitions to network-select for a document-store document with no chainId', async () => {
      vi.mocked(getChainId).mockReturnValue(null as any)
      vi.mocked(isTransferableRecord).mockReturnValue(false)
      vi.mocked(isWrappedV2Document).mockReturnValue(true)
      vi.mocked(getDocumentData).mockReturnValue({
        issuers: [{ documentStore: '0xabc' }],
      } as any)

      const { result } = renderHook(() => useVerify(), { wrapper })
      await act(async () => {
        triggerFileInput(result, makeFile({ test: true }))
      })
      await waitFor(() =>
        expect(result.current.verifyStatus).toBe('network-select')
      )
    })

    it('proceeds to verify (not network-select) for an OCSP-revocable doc with no chainId', async () => {
      vi.mocked(getChainId).mockReturnValue(null as any)
      vi.mocked(isTransferableRecord).mockReturnValue(false)
      vi.mocked(isWrappedV2Document).mockReturnValue(true)
      // OCSP revocation is verified off-chain (HTTP) → no network prompt needed
      vi.mocked(getDocumentData).mockReturnValue({
        issuers: [{ revocation: { type: 'OCSP_RESPONDER' } }],
      } as any)
      vi.mocked(verifyDocument).mockResolvedValue([
        {
          name: 'OpenAttestationHash',
          status: 'VALID',
          type: 'DOCUMENT_INTEGRITY',
        },
      ])

      const { result } = renderHook(() => useVerify(), { wrapper })
      await act(async () => {
        triggerFileInput(result, makeFile({ test: true }))
      })
      await waitFor(() => expect(result.current.verifyStatus).toBe('valid'))
    })

    it('proceeds to verify (not network-select) for a plain doc with no chainId', async () => {
      vi.mocked(getChainId).mockReturnValue(null as any)
      vi.mocked(isTransferableRecord).mockReturnValue(false)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)
      vi.mocked(verifyDocument).mockResolvedValue([
        {
          name: 'OpenAttestationHash',
          status: 'VALID',
          type: 'DOCUMENT_INTEGRITY',
        },
      ])

      const { result } = renderHook(() => useVerify(), { wrapper })
      await act(async () => {
        triggerFileInput(result, makeFile({ test: true }))
      })
      await waitFor(() => expect(result.current.verifyStatus).toBe('valid'))
    })
  })

  // ── handleDrop ─────────────────────────────────────────────────────────────

  describe('handleDrop', () => {
    it('clears dragActive and processes the dropped file', async () => {
      vi.mocked(verifyDocument).mockResolvedValue([
        {
          name: 'OpenAttestationHash',
          status: 'VALID',
          type: 'DOCUMENT_INTEGRITY',
        },
      ])
      vi.mocked(getChainId).mockReturnValue('1' as any)
      vi.mocked(isTransferableRecord).mockReturnValue(false)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)

      const { result } = renderHook(() => useVerify(), { wrapper })
      act(() => {
        result.current.handleDrag(makeDragEvent('dragenter'))
      })
      expect(result.current.dragActive).toBe(true)

      const file = makeFile({ test: true })
      await act(async () => {
        result.current.handleDrop(makeDragEvent('drop', [file]))
      })

      expect(result.current.dragActive).toBe(false)
      await waitFor(() => expect(result.current.verifyStatus).toBe('valid'))
    })

    it('does nothing when drop contains no files', () => {
      const { result } = renderHook(() => useVerify(), { wrapper })
      act(() => {
        result.current.handleDrop(makeDragEvent('drop', []))
      })
      expect(result.current.verifyStatus).toBe('idle')
    })
  })

  // ── handleNetworkCancel ────────────────────────────────────────────────────

  describe('handleNetworkCancel', () => {
    it('returns to idle and clears fileName', async () => {
      vi.mocked(getChainId).mockReturnValue(null as any)
      vi.mocked(isTransferableRecord).mockReturnValue(true)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)

      const { result } = renderHook(() => useVerify(), { wrapper })
      await act(async () => {
        triggerFileInput(result, makeFile({ test: true }, 'pending.tt'))
      })
      await waitFor(() =>
        expect(result.current.verifyStatus).toBe('network-select')
      )

      act(() => {
        result.current.handleNetworkCancel()
      })

      expect(result.current.verifyStatus).toBe('idle')
      expect(result.current.fileName).toBe('')
    })
  })

  // ── handleNetworkConfirm ───────────────────────────────────────────────────

  describe('handleNetworkConfirm', () => {
    it('does nothing when called with no pending document', async () => {
      const { result } = renderHook(() => useVerify(), { wrapper })
      await act(async () => {
        result.current.handleNetworkConfirm('1')
      })
      expect(result.current.verifyStatus).toBe('idle')
      expect(verifyDocument).not.toHaveBeenCalled()
    })

    it('verifies with the selected chainId and resolves to valid', async () => {
      vi.mocked(getChainId).mockReturnValue(null as any)
      vi.mocked(isTransferableRecord).mockReturnValue(true)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)
      vi.mocked(verifyDocument).mockResolvedValue([
        {
          name: 'OpenAttestationHash',
          status: 'VALID',
          type: 'DOCUMENT_INTEGRITY',
        },
      ])

      const { result } = renderHook(() => useVerify(), { wrapper })
      await act(async () => {
        triggerFileInput(result, makeFile({ test: true }))
      })
      await waitFor(() =>
        expect(result.current.verifyStatus).toBe('network-select')
      )

      await act(async () => {
        result.current.handleNetworkConfirm('137')
      })
      await waitFor(() => expect(result.current.verifyStatus).toBe('valid'))
      expect(verifyDocument).toHaveBeenCalledTimes(1)
    })

    it('resolves to invalid when verification returns invalid fragments', async () => {
      vi.mocked(getChainId).mockReturnValue(null as any)
      vi.mocked(isTransferableRecord).mockReturnValue(true)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)
      vi.mocked(verifyDocument).mockResolvedValue([
        {
          name: 'OpenAttestationHash',
          status: 'INVALID',
          type: 'DOCUMENT_INTEGRITY',
        },
      ])

      const { result } = renderHook(() => useVerify(), { wrapper })
      await act(async () => {
        triggerFileInput(result, makeFile({ test: true }))
      })
      await waitFor(() =>
        expect(result.current.verifyStatus).toBe('network-select')
      )

      await act(async () => {
        result.current.handleNetworkConfirm('1')
      })
      await waitFor(() => expect(result.current.verifyStatus).toBe('invalid'))
    })

    it('sets error state when verification throws', async () => {
      vi.mocked(getChainId).mockReturnValue(null as any)
      vi.mocked(isTransferableRecord).mockReturnValue(true)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)
      vi.mocked(verifyDocument).mockRejectedValue(new Error('Network timeout'))

      const { result } = renderHook(() => useVerify(), { wrapper })
      await act(async () => {
        triggerFileInput(result, makeFile({ test: true }))
      })
      await waitFor(() =>
        expect(result.current.verifyStatus).toBe('network-select')
      )

      await act(async () => {
        result.current.handleNetworkConfirm('1')
      })
      await waitFor(() => expect(result.current.verifyStatus).toBe('error'))
      expect(result.current.errorType).toBe(TYPES.VERIFICATION_ERROR)
    })
  })

  // ── getGroupStatus ─────────────────────────────────────────────────────────

  describe('getGroupStatus', () => {
    const setup = async (
      fragments: {
        name: string
        status: 'VALID' | 'INVALID' | 'SKIPPED'
        type: 'DOCUMENT_INTEGRITY' | 'DOCUMENT_STATUS' | 'ISSUER_IDENTITY'
      }[]
    ) => {
      vi.mocked(verifyDocument).mockResolvedValue(fragments)
      vi.mocked(getChainId).mockReturnValue('1' as any)
      vi.mocked(isTransferableRecord).mockReturnValue(false)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)

      const { result } = renderHook(() => useVerify(), { wrapper })
      await act(async () => {
        triggerFileInput(result, makeFile({ test: true }))
      })
      await waitFor(() =>
        expect(['valid', 'invalid']).toContain(result.current.verifyStatus)
      )
      return result
    }

    it('returns VALID when all fragments of a type are VALID', async () => {
      const result = await setup([
        { name: 'a', status: 'VALID', type: 'DOCUMENT_INTEGRITY' },
        { name: 'b', status: 'VALID', type: 'DOCUMENT_INTEGRITY' },
      ])
      expect(result.current.getGroupStatus('DOCUMENT_INTEGRITY')).toBe('VALID')
    })

    it('returns INVALID when any fragment of a type is INVALID', async () => {
      const result = await setup([
        { name: 'a', status: 'VALID', type: 'DOCUMENT_INTEGRITY' },
        { name: 'b', status: 'INVALID', type: 'DOCUMENT_INTEGRITY' },
      ])
      expect(result.current.getGroupStatus('DOCUMENT_INTEGRITY')).toBe(
        'INVALID'
      )
    })

    it('returns INVALID when all fragments of a type are SKIPPED', async () => {
      const result = await setup([
        { name: 'a', status: 'SKIPPED', type: 'DOCUMENT_INTEGRITY' },
        { name: 'b', status: 'SKIPPED', type: 'DOCUMENT_INTEGRITY' },
      ])
      expect(result.current.getGroupStatus('DOCUMENT_INTEGRITY')).toBe(
        'INVALID'
      )
    })

    it('returns INVALID for an unknown type with no matching fragments', async () => {
      const result = await setup([
        { name: 'a', status: 'VALID', type: 'DOCUMENT_INTEGRITY' },
      ])
      expect(result.current.getGroupStatus('UNKNOWN_TYPE')).toBe('INVALID')
    })

    it('returns INVALID before any file has been verified', () => {
      const { result } = renderHook(() => useVerify(), { wrapper })
      expect(result.current.getGroupStatus('DOCUMENT_INTEGRITY')).toBe(
        'INVALID'
      )
    })
  })

  // ── New state values (issuerName, isTransferable, tags) ───────────────────

  describe('new state values', () => {
    it('starts with empty issuerName', () => {
      const { result } = renderHook(() => useVerify(), { wrapper })
      expect(result.current.issuerName).toBe('')
    })

    it('starts with isTransferable false', () => {
      const { result } = renderHook(() => useVerify(), { wrapper })
      expect(result.current.isTransferable).toBe(false)
    })

    it('starts with an empty tags array', () => {
      const { result } = renderHook(() => useVerify(), { wrapper })
      expect(result.current.tags).toEqual([])
    })

    it('sets isTransferable to true when document is a transferable record', async () => {
      vi.mocked(verifyDocument).mockResolvedValue([
        {
          name: 'OpenAttestationHash',
          status: 'VALID',
          type: 'DOCUMENT_INTEGRITY',
        },
      ])
      vi.mocked(getChainId).mockReturnValue('1' as any)
      vi.mocked(isTransferableRecord).mockReturnValue(true)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)

      const { result } = renderHook(() => useVerify(), { wrapper })
      await act(async () => {
        triggerFileInput(result, makeFile({ test: true }))
      })
      await waitFor(() =>
        expect(['valid', 'invalid']).toContain(result.current.verifyStatus)
      )
      expect(result.current.isTransferable).toBe(true)
    })

    it('sets isTransferable to false when document is not transferable', async () => {
      vi.mocked(verifyDocument).mockResolvedValue([
        {
          name: 'OpenAttestationHash',
          status: 'VALID',
          type: 'DOCUMENT_INTEGRITY',
        },
      ])
      vi.mocked(getChainId).mockReturnValue('1' as any)
      vi.mocked(isTransferableRecord).mockReturnValue(false)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)

      const { result } = renderHook(() => useVerify(), { wrapper })
      await act(async () => {
        triggerFileInput(result, makeFile({ test: true }))
      })
      await waitFor(() =>
        expect(['valid', 'invalid']).toContain(result.current.verifyStatus)
      )
      expect(result.current.isTransferable).toBe(false)
    })

    it('resets issuerName, isTransferable, and tags on handleReset', async () => {
      vi.mocked(verifyDocument).mockResolvedValue([
        {
          name: 'OpenAttestationHash',
          status: 'VALID',
          type: 'DOCUMENT_INTEGRITY',
        },
      ])
      vi.mocked(getChainId).mockReturnValue('1' as any)
      vi.mocked(isTransferableRecord).mockReturnValue(false)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)

      const { result } = renderHook(() => useVerify(), { wrapper })
      await act(async () => {
        triggerFileInput(result, makeFile({ test: true }))
      })
      await waitFor(() => expect(result.current.verifyStatus).toBe('valid'))

      act(() => {
        result.current.handleReset()
      })

      expect(result.current.issuerName).toBe('')
      expect(result.current.isTransferable).toBe(false)
      expect(result.current.tags).toEqual([])
    })
  })

  // ── makeExplorerAddressURL ─────────────────────────────────────────────────

  describe('makeExplorerAddressURL', () => {
    it('returns undefined for an unknown chainId', () => {
      expect(makeExplorerAddressURL('0xabc', '9999')).toBeUndefined()
    })

    it('builds the correct explorer URL for a known chain with an explorerUrl', () => {
      // chainId '1' mock has explorerUrl: 'https://etherscan.io'
      const url = makeExplorerAddressURL('0xdeadbeef', '1')
      expect(url).toBe('https://etherscan.io/address/0xdeadbeef')
    })

    it('builds the correct explorer URL for another known chain', () => {
      // chainId '137' mock has explorerUrl: 'https://polygonscan.com'
      const url = makeExplorerAddressURL('0xcafe', '137')
      expect(url).toBe('https://polygonscan.com/address/0xcafe')
    })
  })

  // ── loadDocument ──────────────────────────────────────────────────────────

  describe('loadDocument', () => {
    it('sets fileName and transitions to valid on successful verification', async () => {
      vi.mocked(verifyDocument).mockResolvedValue([
        {
          name: 'OpenAttestationHash',
          status: 'VALID',
          type: 'DOCUMENT_INTEGRITY',
        },
      ])
      vi.mocked(isTransferableRecord).mockReturnValue(false)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)

      const { result } = renderHook(() => useVerify(), { wrapper })

      await act(async () => {
        await result.current.loadDocument(
          { test: true },
          '11155111',
          'action-doc.json'
        )
      })

      await waitFor(() => expect(result.current.verifyStatus).toBe('valid'))
      expect(result.current.fileName).toBe('action-doc.json')
    })

    it('transitions through verifying before settling to valid', async () => {
      let resolveFn!: (v: any) => void
      vi.mocked(verifyDocument).mockReturnValue(
        new Promise(res => {
          resolveFn = res
        })
      )
      vi.mocked(isTransferableRecord).mockReturnValue(false)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)

      const { result } = renderHook(() => useVerify(), { wrapper })

      act(() => {
        result.current.loadDocument({ test: true }, '1', 'doc.json')
      })

      expect(result.current.verifyStatus).toBe('verifying')

      await act(async () => {
        resolveFn([
          {
            name: 'OpenAttestationHash',
            status: 'VALID',
            type: 'DOCUMENT_INTEGRITY',
          },
        ])
      })
      await waitFor(() => expect(result.current.verifyStatus).toBe('valid'))
    })

    it('resolves to invalid when fragments are invalid', async () => {
      vi.mocked(verifyDocument).mockResolvedValue([
        {
          name: 'OpenAttestationHash',
          status: 'INVALID',
          type: 'DOCUMENT_INTEGRITY',
        },
      ])
      vi.mocked(isTransferableRecord).mockReturnValue(false)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)

      const { result } = renderHook(() => useVerify(), { wrapper })

      await act(async () => {
        await result.current.loadDocument({ test: true }, '1', 'doc.json')
      })

      await waitFor(() => expect(result.current.verifyStatus).toBe('invalid'))
    })

    it('sets error state when verifyDocument rejects', async () => {
      vi.mocked(verifyDocument).mockRejectedValue(new Error('RPC down'))
      vi.mocked(isTransferableRecord).mockReturnValue(false)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)

      const { result } = renderHook(() => useVerify(), { wrapper })

      await act(async () => {
        await result.current.loadDocument({ test: true }, '1', 'doc.json')
      })

      await waitFor(() => expect(result.current.verifyStatus).toBe('error'))
      expect(result.current.errorType).toBe(TYPES.VERIFICATION_ERROR)
    })

    it('overwrites fileName when called a second time', async () => {
      vi.mocked(verifyDocument).mockResolvedValue([
        {
          name: 'OpenAttestationHash',
          status: 'VALID',
          type: 'DOCUMENT_INTEGRITY',
        },
      ])
      vi.mocked(isTransferableRecord).mockReturnValue(false)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)

      const { result } = renderHook(() => useVerify(), { wrapper })

      await act(async () => {
        await result.current.loadDocument({ v: 1 }, '1', 'first.json')
      })
      await waitFor(() => expect(result.current.verifyStatus).toBe('valid'))

      await act(async () => {
        await result.current.loadDocument({ v: 2 }, '137', 'second.json')
      })
      await waitFor(() => expect(result.current.verifyStatus).toBe('valid'))

      expect(result.current.fileName).toBe('second.json')
    })

    it('accepts null chainId and still calls verifyDocument', async () => {
      vi.mocked(verifyDocument).mockResolvedValue([
        {
          name: 'OpenAttestationHash',
          status: 'VALID',
          type: 'DOCUMENT_INTEGRITY',
        },
      ])
      vi.mocked(isTransferableRecord).mockReturnValue(false)
      vi.mocked(isDocumentRevokable).mockReturnValue(false)

      const { result } = renderHook(() => useVerify(), { wrapper })

      await act(async () => {
        await result.current.loadDocument({ test: true }, null, 'doc.json')
      })

      await waitFor(() => expect(result.current.verifyStatus).toBe('valid'))
      expect(verifyDocument).toHaveBeenCalledTimes(1)
    })
  })

  // ── getErrorTypeFromFragments ───────────────────────────────────────────────

  describe('getErrorTypeFromFragments', () => {
    it('returns HASH for W3C tampered document', () => {
      const frags = [
        {
          name: 'W3CSignatureIntegrity',
          status: 'INVALID' as const,
          type: 'DOCUMENT_INTEGRITY' as const,
          reason: { code: 0, codeString: '', message: 'Invalid signature.' },
        },
        {
          name: 'W3CEmptyCredentialStatus',
          status: 'VALID' as const,
          type: 'DOCUMENT_STATUS' as const,
        },
        {
          name: 'W3CIssuerIdentity',
          status: 'VALID' as const,
          type: 'ISSUER_IDENTITY' as const,
        },
      ]
      expect(getErrorTypeFromFragments(frags)).toBe(TYPES.HASH)
    })

    it('returns REVOKED for W3C revoked document', () => {
      const frags = [
        {
          name: 'W3CSignatureIntegrity',
          status: 'VALID' as const,
          type: 'DOCUMENT_INTEGRITY' as const,
        },
        {
          name: 'W3CCredentialStatus',
          status: 'INVALID' as const,
          type: 'DOCUMENT_STATUS' as const,
          reason: {
            code: 11,
            codeString: 'REVOKED',
            message: 'Document has been revoked.',
          },
        },
        {
          name: 'W3CIssuerIdentity',
          status: 'VALID' as const,
          type: 'ISSUER_IDENTITY' as const,
        },
      ]
      expect(getErrorTypeFromFragments(frags)).toBe(TYPES.REVOKED)
    })

    it('returns IDENTITY for W3C invalid issuer', () => {
      const frags = [
        {
          name: 'W3CSignatureIntegrity',
          status: 'VALID' as const,
          type: 'DOCUMENT_INTEGRITY' as const,
        },
        {
          name: 'W3CEmptyCredentialStatus',
          status: 'VALID' as const,
          type: 'DOCUMENT_STATUS' as const,
        },
        {
          name: 'W3CIssuerIdentity',
          status: 'INVALID' as const,
          type: 'ISSUER_IDENTITY' as const,
          reason: {
            code: 0,
            codeString: 'INVALID_IDENTITY',
            message: 'Could not find identity',
          },
        },
      ]
      expect(getErrorTypeFromFragments(frags)).toBe(TYPES.IDENTITY)
    })

    it('returns HASH for OA tampered document', () => {
      const frags = [
        {
          name: 'OpenAttestationHash',
          status: 'INVALID' as const,
          type: 'DOCUMENT_INTEGRITY' as const,
          reason: {
            code: 0,
            codeString: 'DOCUMENT_TAMPERED',
            message: 'Document has been tampered with',
          },
        },
        {
          name: 'OpenAttestationEthereumDocumentStoreStatus',
          status: 'VALID' as const,
          type: 'DOCUMENT_STATUS' as const,
        },
        {
          name: 'OpenAttestationDnsTxtIdentityProof',
          status: 'VALID' as const,
          type: 'ISSUER_IDENTITY' as const,
        },
      ]
      expect(getErrorTypeFromFragments(frags)).toBe(TYPES.HASH)
    })

    it('returns SERVER_ERROR for OA server error', () => {
      const frags = [
        {
          name: 'OpenAttestationHash',
          status: 'VALID' as const,
          type: 'DOCUMENT_INTEGRITY' as const,
        },
        {
          name: 'OpenAttestationEthereumTokenRegistryStatus',
          status: 'ERROR' as const,
          type: 'DOCUMENT_STATUS' as const,
          reason: {
            code: 500,
            codeString: 'SERVER_ERROR',
            message: 'Unable to connect to the network, please try again later',
          },
        },
        {
          name: 'OpenAttestationDnsTxtIdentityProof',
          status: 'VALID' as const,
          type: 'ISSUER_IDENTITY' as const,
        },
      ]
      expect(getErrorTypeFromFragments(frags)).toBe(TYPES.SERVER_ERROR)
    })

    it('returns VERIFICATION_ERROR as fallback when no errors', () => {
      expect(getErrorTypeFromFragments([])).toBe(TYPES.VERIFICATION_ERROR)
    })

    // ── App-side overrides for trustvc classification gaps ──────────────────
    it('returns REVOKED for an OCSP-responder revoked document', () => {
      const frags = [
        {
          name: 'OpenAttestationHash',
          status: 'VALID' as const,
          type: 'DOCUMENT_INTEGRITY' as const,
        },
        {
          name: 'OpenAttestationDidSignedDocumentStatus',
          status: 'INVALID' as const,
          type: 'DOCUMENT_STATUS' as const,
          reason: {
            code: 1,
            codeString: 'KEY_COMPROMISE',
            message:
              'Document 0xabc has been revoked under OCSP Responder: https://ocsp.example.com',
          },
        },
        {
          name: 'OpenAttestationDnsDidIdentityProof',
          status: 'VALID' as const,
          type: 'ISSUER_IDENTITY' as const,
        },
      ]
      expect(getErrorTypeFromFragments(frags)).toBe(TYPES.REVOKED)
    })

    it('returns ISSUED for a token registry with an unminted token (ownerOf reverts)', () => {
      const frags = [
        {
          name: 'OpenAttestationHash',
          status: 'VALID' as const,
          type: 'DOCUMENT_INTEGRITY' as const,
        },
        {
          name: 'OpenAttestationEthereumTokenRegistryStatus',
          status: 'ERROR' as const,
          type: 'DOCUMENT_STATUS' as const,
          reason: {
            code: 0,
            codeString: 'BAD_DATA',
            message:
              'invalid length for result data (value="0x08c379a0…", info={ "method": "ownerOf" }, code=BAD_DATA)',
          },
        },
        {
          name: 'OpenAttestationDnsTxtIdentityProof',
          status: 'VALID' as const,
          type: 'ISSUER_IDENTITY' as const,
        },
      ]
      expect(getErrorTypeFromFragments(frags)).toBe(TYPES.ISSUED)
    })

    it('returns CONTRACT_NOT_FOUND for a token registry with no contract (empty ownerOf result)', () => {
      const frags = [
        {
          name: 'OpenAttestationHash',
          status: 'VALID' as const,
          type: 'DOCUMENT_INTEGRITY' as const,
        },
        {
          name: 'OpenAttestationEthereumTokenRegistryStatus',
          status: 'ERROR' as const,
          type: 'DOCUMENT_STATUS' as const,
          reason: {
            code: 0,
            codeString: 'BAD_DATA',
            message:
              'could not decode result data (value="0x", info={ "method": "ownerOf" }, code=BAD_DATA)',
          },
        },
        {
          name: 'OpenAttestationDnsTxtIdentityProof',
          status: 'VALID' as const,
          type: 'ISSUER_IDENTITY' as const,
        },
      ]
      expect(getErrorTypeFromFragments(frags)).toBe(TYPES.CONTRACT_NOT_FOUND)
    })

    // W3C TransferableRecords status failures keep the generic INVALID type (title
    // "Document is invalid") but surface the verifier's own reason as the UI body via
    // getErrorMessageFromFragments — see below.
    it('keeps generic INVALID type for W3C TransferableRecords no-contract', () => {
      const frags = [
        {
          name: 'EcdsaW3CSignatureIntegrity',
          status: 'VALID' as const,
          type: 'DOCUMENT_INTEGRITY' as const,
        },
        {
          name: 'TransferableRecords',
          status: 'INVALID' as const,
          type: 'DOCUMENT_STATUS' as const,
          reason: {
            code: 0,
            codeString: 'INVALID',
            message: 'Token registry is not found',
          },
        },
        {
          name: 'W3CIssuerIdentity',
          status: 'VALID' as const,
          type: 'ISSUER_IDENTITY' as const,
        },
      ]
      expect(getErrorTypeFromFragments(frags)).toBe(TYPES.INVALID)
    })

    it('keeps generic INVALID type for W3C TransferableRecords not minted', () => {
      const frags = [
        {
          name: 'EcdsaW3CSignatureIntegrity',
          status: 'VALID' as const,
          type: 'DOCUMENT_INTEGRITY' as const,
        },
        {
          name: 'TransferableRecords',
          status: 'INVALID' as const,
          type: 'DOCUMENT_STATUS' as const,
          reason: {
            code: 0,
            codeString: 'INVALID',
            message: 'Document has not been issued under token registry',
          },
        },
        {
          name: 'W3CIssuerIdentity',
          status: 'VALID' as const,
          type: 'ISSUER_IDENTITY' as const,
        },
      ]
      expect(getErrorTypeFromFragments(frags)).toBe(TYPES.INVALID)
    })
  })

  // ── getErrorMessageFromFragments ────────────────────────────────────────────
  describe('getErrorMessageFromFragments', () => {
    const trFrag = (message: string) => [
      {
        name: 'EcdsaW3CSignatureIntegrity',
        status: 'VALID' as const,
        type: 'DOCUMENT_INTEGRITY' as const,
      },
      {
        name: 'TransferableRecords',
        status: 'INVALID' as const,
        type: 'DOCUMENT_STATUS' as const,
        reason: { code: 0, codeString: 'INVALID', message },
      },
      {
        name: 'W3CIssuerIdentity',
        status: 'VALID' as const,
        type: 'ISSUER_IDENTITY' as const,
      },
    ]

    it('returns the verbatim reason for a W3C TransferableRecords no-contract', () => {
      expect(
        getErrorMessageFromFragments(trFrag('Token registry is not found'))
      ).toBe('Token registry is not found')
    })

    it('returns the verbatim reason for a W3C TransferableRecords not minted', () => {
      expect(
        getErrorMessageFromFragments(
          trFrag('Document has not been issued under token registry')
        )
      ).toBe('Document has not been issued under token registry')
    })

    it('returns undefined for other TransferableRecords reasons', () => {
      expect(
        getErrorMessageFromFragments(trFrag('some other failure'))
      ).toBeUndefined()
    })

    it('returns undefined when there is no TransferableRecords failure', () => {
      expect(getErrorMessageFromFragments([])).toBeUndefined()
    })
  })
})
