import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useVerify } from './useVerify'
import { DocumentProvider } from '../../common/contexts/DocumentContext'

// ─── Mock sentry — prevents @sentry/react from patching global timers ────────

vi.mock('../../../lib/sentry', () => ({
  captureVerificationBreadcrumb: vi.fn(),
  captureVerificationException: vi.fn(),
  captureVerificationInvalid: vi.fn(),
  isSentryEnabled: vi.fn(() => false),
  initSentry: vi.fn(),
}))

// ─── Mock analytics ───────────────────────────────────────────────────────────

vi.mock('../../../utils/analytics', () => ({
  trackDocumentDropped: vi.fn(),
  trackDocumentVerified: vi.fn(),
  trackDocumentVerifyError: vi.fn(),
  trackNetworkSelectionShown: vi.fn(),
  trackNetworkSelected: vi.fn(),
  trackNetworkSelectionCancelled: vi.fn(),
  trackVerificationReset: vi.fn(),
}))

// ─── Mock @trustvc/trustvc ────────────────────────────────────────────────────

Object.defineProperty(import.meta, 'env', {
  value: {
    VITE_RPC_URL_1: 'https://eth-mainnet.example.com',
    VITE_RPC_URL_137: 'https://polygon.example.com',
  },
  writable: true,
  configurable: true,
})

if (!File.prototype.text) {
  File.prototype.text = function () {
    return new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsText(this)
    })
  }
}

// processFile now reads raw bytes to sniff for the PDF header before choosing
// the JSON vs Verifiable-PDF path; jsdom's File lacks arrayBuffer, browsers have it.
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
  const mkChain = (
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
    isTransferableRecord: vi.fn().mockReturnValue(false),
    isDocumentRevokable: vi.fn(),
    SUPPORTED_CHAINS: {
      '1': mkChain(
        '1',
        'homestead',
        'https://eth-mainnet.example.com',
        'https://etherscan.io'
      ),
      '137': mkChain(
        '137',
        'matic',
        'https://polygon.example.com',
        'https://polygonscan.com'
      ),
      '50': mkChain(
        '50',
        'xdc',
        'https://xdc-rpc.com',
        'https://xdc-explorer.io'
      ),
      '101010': mkChain(
        '101010',
        'stability',
        'https://stability-rpc.com',
        'https://stability-explorer.io'
      ),
      '1338': mkChain(
        '1338',
        'astron',
        'https://astron-rpc.com',
        'https://astron-explorer.io'
      ),
      '11155111': mkChain(
        '11155111',
        'sepolia',
        'https://sepolia-rpc.com',
        'https://sepolia-explorer.io'
      ),
      '80002': mkChain(
        '80002',
        'amoy',
        'https://amoy-rpc.com',
        'https://amoy-explorer.io'
      ),
      '51': mkChain(
        '51',
        'xdcapothem',
        'https://apothem-rpc.com',
        'https://apothem-explorer.io'
      ),
      '20180427': mkChain(
        '20180427',
        'stabilitytestnet',
        'https://stability-test-rpc.com',
        'https://stability-test-explorer.io'
      ),
      '21002': mkChain(
        '21002',
        'astrontestnet',
        'https://astron-test-rpc.com',
        'https://astron-test-explorer.io'
      ),
    },
    isWrappedV2Document: vi.fn().mockReturnValue(false),
    isWrappedV3Document: vi.fn().mockReturnValue(false),
    isRawV2Document: vi.fn().mockReturnValue(false),
    isSignedWrappedV2Document: vi.fn().mockReturnValue(false),
    isRawV3Document: vi.fn().mockReturnValue(false),
    isSignedWrappedV3Document: vi.fn().mockReturnValue(false),
    isTitleEscrowVersion: vi.fn().mockResolvedValue(false),
    TitleEscrowInterface: { V4: 'V4', V5: 'V5' },
    getTokenRegistryAddress: vi.fn().mockReturnValue(undefined),
    getTokenId: vi.fn().mockReturnValue(undefined),
    getDocumentData: vi.fn().mockReturnValue({ id: 'test-key-id' }),
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

// ─── Import after mocks ───────────────────────────────────────────────────────

import * as analytics from '../../../utils/analytics'
import {
  verifyDocument,
  getChainId,
  isTransferableRecord,
  CHAIN_ID,
} from '@trustvc/trustvc'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(DocumentProvider, null, children)

const makeFile = (content: object, name = 'doc.json') =>
  new File([JSON.stringify(content)], name, { type: 'application/json' })

const validFragments = [
  {
    name: 'OpenAttestationHash',
    type: 'DOCUMENT_INTEGRITY',
    status: 'VALID',
    data: {},
  },
  {
    name: 'OpenAttestationDnsTxtIdentityProof',
    type: 'ISSUER_IDENTITY',
    status: 'VALID',
    data: { identifier: 'example.com', location: 'example.com' },
  },
  {
    name: 'OpenAttestationEthereumDocumentStoreStatus',
    type: 'DOCUMENT_STATUS',
    status: 'VALID',
    data: {},
  },
]

const makeDragEvent = (file: File): React.DragEvent =>
  ({
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    type: 'drop',
    dataTransfer: { files: [file] as unknown as FileList },
  }) as unknown as React.DragEvent

const makeInputEvent = (file: File): React.ChangeEvent<HTMLInputElement> =>
  ({
    target: { files: [file] as unknown as FileList, value: '' },
  }) as unknown as React.ChangeEvent<HTMLInputElement>

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getChainId).mockReturnValue(CHAIN_ID.mainnet)
  vi.mocked(isTransferableRecord).mockReturnValue(false)
  vi.mocked(verifyDocument).mockResolvedValue(validFragments as any)
})

// ─── DOCUMENT_DROPPED source tracking ────────────────────────────────────────

describe('trackDocumentDropped', () => {
  it('fires with source="drop" on handleDrop', async () => {
    const { result } = renderHook(() => useVerify(), { wrapper })

    const file = makeFile({
      version: 'https://schema.openattestation.com/2.0/schema.json',
    })
    await act(async () => {
      result.current.handleDrop(makeDragEvent(file))
      await new Promise(r => setTimeout(r, 0))
    })

    expect(analytics.trackDocumentDropped).toHaveBeenCalledWith(
      file.name,
      'drop'
    )
  })

  it('fires with source="file_picker" on handleFileInput', async () => {
    const { result } = renderHook(() => useVerify(), { wrapper })

    const file = makeFile({ data: 'test' }, 'upload.json')
    await act(async () => {
      result.current.handleFileInput(makeInputEvent(file))
      await new Promise(r => setTimeout(r, 0))
    })

    expect(analytics.trackDocumentDropped).toHaveBeenCalledWith(
      'upload.json',
      'file_picker'
    )
  })

  it('fires with source="url" on loadDocument by default', async () => {
    const { result } = renderHook(() => useVerify(), { wrapper })

    await act(async () => {
      await result.current.loadDocument({ data: {} }, '1', 'sample.json')
    })

    expect(analytics.trackDocumentDropped).toHaveBeenCalledWith(
      'sample.json',
      'url'
    )
  })

  it('fires with source="demo" when explicitly passed to loadDocument', async () => {
    const { result } = renderHook(() => useVerify(), { wrapper })

    await act(async () => {
      await result.current.loadDocument({ data: {} }, '1', 'demo.json', 'demo')
    })

    expect(analytics.trackDocumentDropped).toHaveBeenCalledWith(
      'demo.json',
      'demo'
    )
  })
})

// ─── trackDocumentVerified ────────────────────────────────────────────────────

describe('trackDocumentVerified', () => {
  it('fires after successful verification with extras', async () => {
    const { result } = renderHook(() => useVerify(), { wrapper })

    const doc = { data: 'valid' }
    await act(async () => {
      await result.current.loadDocument(doc, '1', 'verified.json')
    })

    await waitFor(() => {
      expect(analytics.trackDocumentVerified).toHaveBeenCalled()
    })

    const [, , isValid, , , extras] = vi.mocked(analytics.trackDocumentVerified)
      .mock.calls[0]
    expect(isValid).toBe(true)
    expect(extras).toHaveProperty('isExpired')
    expect(extras).toHaveProperty('isTransferable')
    expect(extras).toHaveProperty('tokenRegistryVersion')
    expect(extras).toHaveProperty('chainId', '1')
  })

  it('fires with invalid result when fragments show error', async () => {
    vi.mocked(verifyDocument).mockResolvedValue([
      {
        name: 'OpenAttestationHash',
        type: 'DOCUMENT_INTEGRITY',
        status: 'INVALID',
        data: {},
      },
      {
        name: 'OpenAttestationDnsTxtIdentityProof',
        type: 'ISSUER_IDENTITY',
        status: 'VALID',
        data: {},
      },
      {
        name: 'OpenAttestationEthereumDocumentStoreStatus',
        type: 'DOCUMENT_STATUS',
        status: 'VALID',
        data: {},
      },
    ] as any)

    const { result } = renderHook(() => useVerify(), { wrapper })

    await act(async () => {
      await result.current.loadDocument({}, '1', 'invalid.json')
    })

    await waitFor(() => {
      expect(analytics.trackDocumentVerified).toHaveBeenCalled()
    })

    const [, , isValid] = vi.mocked(analytics.trackDocumentVerified).mock
      .calls[0]
    expect(isValid).toBe(false)
  })
})

// ─── trackDocumentVerifyError ─────────────────────────────────────────────────

describe('trackDocumentVerifyError', () => {
  it('fires when file is not valid JSON', async () => {
    const { result } = renderHook(() => useVerify(), { wrapper })

    const badFile = new File(['not valid json {{{'], 'bad.json', {
      type: 'application/json',
    })
    await act(async () => {
      result.current.handleFileInput(makeInputEvent(badFile))
      await new Promise(r => setTimeout(r, 50))
    })

    await waitFor(() => {
      expect(analytics.trackDocumentVerifyError).toHaveBeenCalled()
    })
  })

  it('fires when verifyDocument throws', async () => {
    vi.mocked(verifyDocument).mockRejectedValue(new Error('Network failure'))

    const { result } = renderHook(() => useVerify(), { wrapper })

    await act(async () => {
      await result.current.loadDocument({}, '1', 'error.json')
    })

    await waitFor(() => {
      expect(analytics.trackDocumentVerifyError).toHaveBeenCalled()
    })
  })
})

// ─── trackNetworkSelectionShown ───────────────────────────────────────────────

describe('trackNetworkSelectionShown', () => {
  it('fires when document requires network selection', async () => {
    vi.mocked(getChainId).mockReturnValue(null as any)
    vi.mocked(isTransferableRecord).mockReturnValue(true)

    const { result } = renderHook(() => useVerify(), { wrapper })

    const file = makeFile({
      version: 'https://schema.openattestation.com/2.0/schema.json',
    })
    await act(async () => {
      result.current.handleFileInput(makeInputEvent(file))
      await new Promise(r => setTimeout(r, 0))
    })

    await waitFor(() => {
      expect(analytics.trackNetworkSelectionShown).toHaveBeenCalled()
    })

    expect(result.current.verifyStatus).toBe('network-select')
  })
})

// ─── trackNetworkSelected ─────────────────────────────────────────────────────

describe('trackNetworkSelected', () => {
  it('fires with the chosen chain when handleNetworkConfirm is called', async () => {
    vi.mocked(getChainId).mockReturnValue(null as any)
    vi.mocked(isTransferableRecord).mockReturnValue(true)

    const { result } = renderHook(() => useVerify(), { wrapper })

    const file = makeFile({
      version: 'https://schema.openattestation.com/2.0/schema.json',
    })
    await act(async () => {
      result.current.handleFileInput(makeInputEvent(file))
      await new Promise(r => setTimeout(r, 0))
    })

    await waitFor(() =>
      expect(result.current.verifyStatus).toBe('network-select')
    )

    await act(async () => {
      await result.current.handleNetworkConfirm('137')
    })

    expect(analytics.trackNetworkSelected).toHaveBeenCalledWith('137')
  })
})

// ─── trackNetworkSelectionCancelled ──────────────────────────────────────────

describe('trackNetworkSelectionCancelled', () => {
  it('fires when handleNetworkCancel is called', async () => {
    vi.mocked(getChainId).mockReturnValue(null as any)
    vi.mocked(isTransferableRecord).mockReturnValue(true)

    const { result } = renderHook(() => useVerify(), { wrapper })

    const file = makeFile({
      version: 'https://schema.openattestation.com/2.0/schema.json',
    })
    await act(async () => {
      result.current.handleFileInput(makeInputEvent(file))
      await new Promise(r => setTimeout(r, 0))
    })

    await waitFor(() =>
      expect(result.current.verifyStatus).toBe('network-select')
    )

    act(() => {
      result.current.handleNetworkCancel()
    })

    expect(analytics.trackNetworkSelectionCancelled).toHaveBeenCalled()
    expect(result.current.verifyStatus).toBe('idle')
  })
})

// ─── trackVerificationReset ───────────────────────────────────────────────────

describe('trackVerificationReset', () => {
  it('fires when handleReset is called', async () => {
    const { result } = renderHook(() => useVerify(), { wrapper })

    await act(async () => {
      await result.current.loadDocument({}, '1', 'doc.json')
    })

    act(() => {
      result.current.handleReset()
    })

    expect(analytics.trackVerificationReset).toHaveBeenCalled()
    expect(result.current.verifyStatus).toBe('idle')
  })
})
