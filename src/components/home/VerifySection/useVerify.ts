import React, { useState, useRef } from 'react'
import {
  verifyDocument,
  getChainId,
  SUPPORTED_CHAINS,
  isTransferableRecord,
  vc,
  isWrappedV2Document,
  isWrappedV3Document,
  isRawV2Document,
  isSignedWrappedV2Document,
  isRawV3Document,
  isSignedWrappedV3Document,
  isTitleEscrowVersion,
  TitleEscrowInterface,
  getTokenRegistryAddress,
  getTokenId,
  getDocumentData as getDocumentDataFromWrappedDocument,
  errorMessageHandling,
  errorMessages,
} from '@trustvc/trustvc'
import { getRpcUrl, getIsExpired } from '../../../utils/helper'
import {
  checkVerifiablePdf,
  isPdf,
  type CarrierCheck,
} from '../../../utils/verifiablePdf'
import { useDocumentContext } from '../../common/contexts/DocumentContext'
import { type VerifyErrorType, getErrorTypeFromError } from './verifyErrorUtils'
import {
  captureVerificationBreadcrumb,
  captureVerificationException,
  captureVerificationInvalid,
} from '../../../lib/sentry'
import {
  trackDocumentDropped,
  trackDocumentVerified,
  trackDocumentVerifyError,
  trackNetworkSelectionShown,
  trackNetworkSelected,
  trackNetworkSelectionCancelled,
  trackVerificationReset,
  type DocumentDroppedSource,
} from '../../../utils/analytics'

export type VerifyStatus =
  | 'idle'
  | 'verifying'
  | 'valid'
  | 'invalid'
  | 'error'
  | 'network-select'

export type VerificationFragmentType =
  | 'DOCUMENT_INTEGRITY'
  | 'DOCUMENT_STATUS'
  | 'ISSUER_IDENTITY'

export interface VerificationFragmentReason {
  code: number
  codeString: string
  message: string
}

export interface VerificationFragment {
  name: string
  status: 'VALID' | 'INVALID' | 'SKIPPED' | 'ERROR'
  type: VerificationFragmentType
  reason?: VerificationFragmentReason
  data?: any
}

export type TokenRegistryVersion = 'V4' | 'V5' | null

export interface UseVerifyReturn {
  verifyStatus: VerifyStatus
  fileName: string
  errorType: VerifyErrorType
  errorMessage?: string
  dragActive: boolean
  verifiedChainId?: string
  issuerName?: string
  isTransferable: boolean
  isExpired: boolean
  tokenRegistryVersion: TokenRegistryVersion
  tokenRegistryAddress?: string
  tags: string[]
  tokenId?: string
  keyId?: string
  rawDocument?: unknown
  carrier: CarrierCheck | null
  getGroupStatus: (_type: string) => 'VALID' | 'INVALID'
  handleDrag: (_e: React.DragEvent) => void
  handleDrop: (_e: React.DragEvent) => void
  handleFileInput: (_e: React.ChangeEvent<HTMLInputElement>) => void
  handleReset: () => void
  handleNetworkConfirm: (_chainId: string) => void
  handleNetworkCancel: () => void
  loadDocument: (
    _doc: unknown,
    _chainId: string | null | undefined,
    _name: string,
    _source?: DocumentDroppedSource
  ) => Promise<void>
}

const computeGroupStatus = (
  frags: VerificationFragment[],
  type: string
): 'VALID' | 'INVALID' => {
  const group = frags.filter(f => f.type === type)
  if (group.length === 0) return 'INVALID'
  if (group.some(f => f.status === 'INVALID' || f.status === 'ERROR'))
    return 'INVALID'
  if (group.some(f => f.status === 'VALID')) return 'VALID'
  return 'INVALID'
}

/**
 * Whether verifying this document reads on-chain state and therefore needs a network.
 * True for: transferable records (token registry), document/certificate stores, and
 * REVOCATION_STORE revocation. False for OCSP_RESPONDER revocation and plain
 * DID-signed docs — those verify off-chain (HTTP / signature), so they should NOT
 * trigger the network-select prompt. (tt-verify has no revocation-type classifier,
 * so we inspect the issuer the same way isDocumentRevokable does internally.)
 */
const requiresNetworkSelection = (doc: unknown): boolean => {
  if (isTransferableRecord(doc as any)) return true
  try {
    if (isWrappedV2Document(doc as any)) {
      const data = getDocumentDataFromWrappedDocument(doc as any) as {
        issuers?: Array<{
          documentStore?: string
          certificateStore?: string
          revocation?: { type?: string }
        }>
      }
      return (data?.issuers ?? []).some(
        i =>
          !!i.documentStore ||
          !!i.certificateStore ||
          i.revocation?.type === 'REVOCATION_STORE'
      )
    }
    if (isWrappedV3Document(doc as any)) {
      const proof = (doc as any).openAttestationMetadata?.proof
      return (
        proof?.method === 'DOCUMENT_STORE' ||
        proof?.revocation?.type === 'REVOCATION_STORE'
      )
    }
  } catch {
    // fall through to false
  }
  return false
}

/**
 * The chainId embedded in the document's own network field. trustvc's getChainId()
 * deliberately ignores this for DNS-DID/DID documents (it assumes they're off-chain),
 * but such a doc can still carry a REVOCATION_STORE that lives on that chain — so use
 * the embedded value as a fallback rather than prompting the user for a network.
 */
const getEmbeddedChainId = (doc: unknown): string | undefined => {
  try {
    const data = getDocumentDataFromWrappedDocument(doc as any) as {
      network?: { chainId?: string | number }
    }
    const chainId = data?.network?.chainId
    return chainId != null ? String(chainId) : undefined
  } catch {
    return undefined
  }
}

/**
 * Detect error type from verification fragments using @trustvc/trustvc library.
 * Returns the first error type, or VERIFICATION_ERROR as fallback.
 */
/**
 * trustvc's OAErrorMessageHandling only recognizes the document-store DOCUMENT_REVOKED
 * code as "revoked"; an OCSP-responder revocation carries an OCSP reason code instead,
 * so it gets mis-bucketed as a generic ethers error. Detect it explicitly.
 */
const isOcspRevoked = (frags: VerificationFragment[]): boolean =>
  frags.some(
    f =>
      f.type === 'DOCUMENT_STATUS' &&
      f.status === 'INVALID' &&
      /revoked under OCSP Responder/i.test((f as any).reason?.message ?? '')
  )

/**
 * An unminted token registry document: ownerOf() reverts with
 * "ERC721: owner query for nonexistent token". On some providers (e.g. local
 * Hardhat) ethers v6 mis-decodes that revert as a BAD_DATA error, so the
 * token-registry fragment is ERROR rather than a clean "not minted" — and falls
 * through to a generic ethers error. Match the ownerOf revert specifically (a real
 * RPC failure is a connection/server error → SERVER_ERROR, never this).
 */
const isTokenRegistryNotMinted = (frags: VerificationFragment[]): boolean =>
  frags.some(f => {
    if (
      f.name !== 'OpenAttestationEthereumTokenRegistryStatus' ||
      f.status !== 'ERROR'
    )
      return false
    const msg = (f as any).reason?.message ?? ''
    // The ownerOf() call reverted with Error(string) "…nonexistent token" — i.e. the
    // registry exists but the token isn't minted. (0x08c379a0 = Error(string) selector.)
    return /ownerOf/.test(msg) && /0x08c379a0/i.test(msg)
  })

/**
 * Token registry address has no contract: ownerOf() returns empty data (value="0x"),
 * which ethers v6 surfaces as a BAD_DATA error instead of tt-verify's CONTRACT_NOT_FOUND.
 * (A document store reports this cleanly; the token registry doesn't.) Distinguished
 * from "not minted" by the empty value (no 0x08c379a0 revert reason).
 */
const isTokenRegistryContractNotFound = (
  frags: VerificationFragment[]
): boolean =>
  frags.some(f => {
    if (
      f.name !== 'OpenAttestationEthereumTokenRegistryStatus' ||
      f.status !== 'ERROR'
    )
      return false
    const msg = (f as any).reason?.message ?? ''
    return /ownerOf/.test(msg) && /value="0x"/.test(msg)
  })

/**
 * A DID-signed doc whose REVOCATION_STORE contract doesn't exist: the revocation
 * check returns INVALID "Contract is not found", but trustvc tags it with the
 * DOCUMENT_REVOKED code → mis-classified as REVOKED. Surface it as CONTRACT_NOT_FOUND
 * (consistent with the document-store no-contract case). Distinct from a genuine
 * revocation-store revoke, whose message is "…has been revoked under contract …".
 */
const isDidSignedContractNotFound = (frags: VerificationFragment[]): boolean =>
  frags.some(
    f =>
      f.name === 'OpenAttestationDidSignedDocumentStatus' &&
      f.status === 'INVALID' &&
      /Contract is not found/i.test((f as any).reason?.message ?? '')
  )

/**
 * W3C TransferableRecords status failures carry a clean, human-readable reason
 * straight from the verifier — "Token registry is not found" (no contract) and
 * "Document has not been issued under token registry" (not minted). For these two
 * cases we surface the verifier's reason verbatim as the UI body (the error type
 * stays the generic INVALID, so the title is unchanged) rather than mapping to a
 * typed message. Scoped to those two strings; any other failure keeps its typed copy.
 */
const W3C_TR_REASON =
  /(has not been issued under token registry|token registry is not found)/i

export const getErrorMessageFromFragments = (
  frags: VerificationFragment[]
): string | undefined => {
  const tr = frags.find(
    f =>
      f.name === 'TransferableRecords' &&
      f.status === 'INVALID' &&
      W3C_TR_REASON.test((f as any).reason?.message ?? '')
  )
  return (tr as any)?.reason?.message || undefined
}

export const getErrorTypeFromFragments = (
  frags: VerificationFragment[]
): VerifyErrorType => {
  try {
    if (isDidSignedContractNotFound(frags))
      return errorMessages.TYPES.CONTRACT_NOT_FOUND
    if (isOcspRevoked(frags)) return errorMessages.TYPES.REVOKED
    if (isTokenRegistryNotMinted(frags)) return errorMessages.TYPES.ISSUED
    if (isTokenRegistryContractNotFound(frags))
      return errorMessages.TYPES.CONTRACT_NOT_FOUND
    const errors = errorMessageHandling(frags as any)
    return errors[0] || errorMessages.TYPES.VERIFICATION_ERROR
  } catch {
    return errorMessages.TYPES.VERIFICATION_ERROR
  }
}

const getV2FormattedDomainNames = (
  verificationStatus: VerificationFragment[]
): string => {
  const joinIssuers = (issuers: string[] | undefined): string => {
    if (!issuers) return 'Unknown'
    const issuerNames = issuers.join(', ')
    return issuerNames?.replace(/,(?=[^,]*$)/, ' and') // regex to find last comma, replace with and
  }

  const formatIdentifier = (
    fragment: VerificationFragment
  ): string | undefined => {
    switch (fragment.name) {
      case 'OpencertsRegistryVerifier': {
        const issuerNames = Array.isArray(fragment?.data)
          ? (fragment.data as Array<{ name?: string }>).reduce<string[]>(
              (acc, issuer) => {
                const name = issuer?.name
                if (typeof name === 'string' && name.trim().length > 0) {
                  acc.push(name)
                }
                return acc
              },
              []
            )
          : undefined
        return joinIssuers(issuerNames)
      }
      case 'OpenAttestationDnsTxtIdentityProof':
      case 'OpenAttestationDnsDidIdentityProof':
        return joinIssuers(
          fragment.data?.map((issuer: any) => issuer.location.toUpperCase())
        )
      case 'OpenAttestationDidIdentityProof':
        return joinIssuers(
          fragment.data?.map((issuer: any) => issuer.did.toUpperCase())
        )
      default:
        return 'Unknown'
    }
  }

  const identityProofFragment = verificationStatus
    .filter(f => f.type === 'ISSUER_IDENTITY')
    .find(f => f.status === 'VALID')

  const dataFragment = identityProofFragment?.data
  const fragmentValidity =
    dataFragment?.length > 0 &&
    dataFragment?.every(
      (issuer: { status: string; verified: boolean }) =>
        issuer.status === 'VALID' || issuer.verified === true
    )

  return fragmentValidity && identityProofFragment
    ? formatIdentifier(identityProofFragment) || 'Unknown'
    : 'Unknown'
}

const getV3IdentityVerificationText = (document: any): string => {
  return (
    document.openAttestationMetadata?.identityProof?.identifier?.toUpperCase() ||
    'Unknown'
  )
}

const getW3CIdentityVerificationText = (document: any): string => {
  const issuer =
    typeof document?.issuer === 'string'
      ? document?.issuer
      : document?.issuer?.id
  return issuer?.toUpperCase() || 'Unknown'
}

const getIssuerName = (
  document: any,
  verificationStatus: VerificationFragment[]
): string => {
  if (!document) return 'Unknown'

  if (isWrappedV2Document(document)) {
    return getV2FormattedDomainNames(verificationStatus)
  } else if (isWrappedV3Document(document)) {
    return getV3IdentityVerificationText(document)
  } else if (vc.isSignedDocument(document)) {
    return getW3CIdentityVerificationText(document)
  }

  return 'Unknown'
}

const detectTokenRegistryVersion = async (
  document: any,
  provider: any
): Promise<TokenRegistryVersion> => {
  if (!document || !isTransferableRecord(document) || !provider) {
    return null
  }

  try {
    // Extract registry address and token ID from document using trustvc utilities
    const registryAddress = getTokenRegistryAddress(document)
    const tokenId = getTokenId(document)

    if (!registryAddress) {
      return null
    }

    // Check if it's Title Escrow V4
    const isTitleEscrowV4 = await isTitleEscrowVersion({
      tokenRegistryAddress: registryAddress,
      tokenId,
      versionInterface: TitleEscrowInterface.V4,
      provider,
    })

    if (isTitleEscrowV4) {
      return 'V4'
    }

    // If not V4, assume V5 for transferable documents
    return 'V5'
  } catch (error) {
    console.error('Error detecting token registry version:', error)
    return null
  }
}

const getDocumentTags = (
  document: any,
  tokenRegistryVersion: TokenRegistryVersion
): string[] => {
  if (!document) return []

  const tags: string[] = []

  // Check if transferable - adds both Transferable and Negotiable tags
  const isTransferableDocument = isTransferableRecord(document)
  if (isTransferableDocument) {
    tags.push('Transferable')
    tags.push('Negotiable')
  }

  // Determine document schema type
  const isOAV2 =
    isRawV2Document(document) ||
    isSignedWrappedV2Document(document) ||
    isWrappedV2Document(document)
  const isOAV3 =
    isRawV3Document(document) ||
    isSignedWrappedV3Document(document) ||
    isWrappedV3Document(document)
  const isW3CVC = vc.isSignedDocument(document) || vc.isRawDocument(document)
  const isW3CVCVersion2_0 = isW3CVC ? vc.isSignedDocumentV2_0(document) : null

  // Add document schema tag
  if (isOAV2 || isOAV3) {
    tags.push('OA')
  } else if (isW3CVC) {
    if (isW3CVCVersion2_0) {
      tags.push('W3C VC V2.0')
    } else {
      tags.push('W3C VC V1.1')
    }
  }

  // Add token registry version tag if available
  if (tokenRegistryVersion === 'V4') {
    tags.push('TR V4')
  } else if (tokenRegistryVersion === 'V5') {
    tags.push('TR V5')
  }

  return tags
}

const getDocumentData = (wrappedDocument: any) => {
  if (
    vc.isSignedDocument(wrappedDocument) ||
    vc.isRawDocument(wrappedDocument)
  ) {
    return wrappedDocument as any
  }
  return getDocumentDataFromWrappedDocument(wrappedDocument)
}
export const makeExplorerAddressURL = (
  address: string,
  chainId: string
): string | undefined => {
  const chainInfo = SUPPORTED_CHAINS[chainId as keyof typeof SUPPORTED_CHAINS]
  if (!chainInfo?.explorerUrl) {
    return undefined
  }
  return new URL(`/address/${address}`, chainInfo.explorerUrl).href
}

export const useVerify = (): UseVerifyReturn => {
  const verificationIdRef = useRef(0)
  const {
    setKeyId: setKeyIdContext,
    setTokenRegistryVersion: setTokenRegistryVersionContext,
    setTokenId: setTokenIdContext,
    setTokenRegistryAddress: setTokenRegistryAddressContext,
  } = useDocumentContext()
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>('idle')
  const [fragments, setFragments] = useState<VerificationFragment[]>([])
  const [fileName, setFileName] = useState('')
  const [errorType, setErrorType] = useState<VerifyErrorType>(
    errorMessages.TYPES.VERIFICATION_ERROR
  )
  // Optional verbatim error body (overrides the typed message) — used for the W3C
  // TransferableRecords status reasons. undefined → fall back to the typed message.
  const [errorMessage, setErrorMessage] = useState<string | undefined>(
    undefined
  )
  const [dragActive, setDragActive] = useState(false)
  const [pendingDoc, setPendingDoc] = useState<unknown>(null)
  const [verifiedChainId, setVerifiedChainId] = useState<string>('')
  const [issuerName, setIssuerName] = useState<string>('')
  const [isTransferable, setIsTransferable] = useState<boolean>(false)
  const [tokenRegistryVersion, setTokenRegistryVersion] =
    useState<TokenRegistryVersion>(null)
  const [tokenRegistryAddress, setTokenRegistryAddress] = useState<
    string | undefined
  >(undefined)
  const [tags, setTags] = useState<string[]>([])
  const [tokenId, setTokenId] = useState<string | undefined>(undefined)
  const [keyId, setKeyId] = useState<string | undefined>(undefined)
  const [rawDocument, setRawDocument] = useState<unknown>(undefined)
  const [isExpired, setIsExpired] = useState<boolean>(false)
  // Carrier-level check for Verifiable PDFs (the embedded-credential + visual-layer
  // integrity verification this site performs, separate from the TrustVC fragments).
  const [carrier, setCarrier] = useState<CarrierCheck | null>(null)
  const runVerification = async (
    doc: unknown,
    chainId: string | null | undefined,
    currentId: number,
    verificationFileName?: string
  ) => {
    const isStale = () => currentId !== verificationIdRef.current

    const options: { rpcProviderUrl?: string } = {}
    const rpcUrl = getRpcUrl(chainId ?? '1')
    if (rpcUrl) options.rpcProviderUrl = rpcUrl

    const results = (await verifyDocument(
      doc as any,
      options
    )) as VerificationFragment[]

    if (isStale()) return

    setFragments(results)

    const types = [...new Set(results.map(f => f.type))]
    const groupStatuses = types.map(type => computeGroupStatus(results, type))
    const hasAtLeastOneValid = groupStatuses.some(s => s === 'VALID')
    const hasNoInvalid = groupStatuses.every(s => s !== 'INVALID')
    const isValid = hasAtLeastOneValid && hasNoInvalid
    const errorType = !isValid ? getErrorTypeFromFragments(results) : undefined
    if (!isValid) {
      const errorMessage = getErrorMessageFromFragments(results)
      setErrorType(errorType!)
      setErrorMessage(errorMessage)
      captureVerificationInvalid({
        doc,
        fileName: (verificationFileName ?? fileName) || undefined,
        chainId,
        errorType: errorType!,
        errorMessage,
        fragments: results,
      })
    }

    // Compute issuer name
    const issuer = getIssuerName(doc, results)
    setIssuerName(issuer)

    // Check if document is transferable
    const transferable = isTransferableRecord(doc as any)
    setIsTransferable(transferable)

    // Extract token registry address
    const registryAddress = transferable
      ? getTokenRegistryAddress(doc as any)
      : undefined
    setTokenRegistryAddress(registryAddress)
    setTokenRegistryAddressContext(registryAddress || null)

    const isExpired = getIsExpired(doc)
    setIsExpired(isExpired)

    //add code to fetch TokenId , keyId from the document
    const _keyId = getDocumentData(doc as any)?.id
    setKeyId(_keyId)
    setKeyIdContext(_keyId || null)

    if (transferable) {
      const _tokenId = getTokenId(doc as any)
      setTokenId(_tokenId)
      setTokenIdContext(_tokenId || null)
    } else {
      setTokenId(undefined)
      setTokenIdContext(null)
    }

    // Detect token registry version (async)
    let trVersion: TokenRegistryVersion = null
    if (transferable && rpcUrl) {
      try {
        // Create a simple provider for the detection
        const { ethers } = await import('ethers')
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl)
        trVersion = await detectTokenRegistryVersion(doc, provider)
      } catch (error) {
        console.error('Failed to detect token registry version:', error)
      }
    }

    if (isStale()) return

    setTokenRegistryVersion(trVersion)
    setTokenRegistryVersionContext(trVersion)

    // Compute document tags
    const documentTags = getDocumentTags(doc, trVersion)
    setTags(documentTags)

    setRawDocument(doc)
    setVerifiedChainId(chainId ?? '')
    setVerifyStatus(isValid ? 'valid' : 'invalid')

    captureVerificationBreadcrumb(
      isValid
        ? 'Verification completed (valid)'
        : 'Verification completed (invalid)',
      {
        chainId: chainId ?? undefined,
        fileName: (verificationFileName ?? fileName) || undefined,
      }
    )
    trackDocumentVerified(doc, results, isValid, issuer, errorType, {
      isExpired,
      isTransferable: transferable,
      tokenRegistryVersion: trVersion,
      chainId: chainId ?? null,
    })
  }

  const clearVerificationMetadata = () => {
    setVerifiedChainId('')
    setIssuerName('')
    setIsTransferable(false)
    setTokenRegistryVersion(null)
    setTokenRegistryAddress(undefined)
    setTags([])
    setTokenId(undefined)
    setKeyId(undefined)
    setRawDocument(undefined)
    setErrorMessage(undefined)
    setCarrier(null)
    setTokenRegistryAddressContext(null)
    setTokenRegistryVersionContext(null)
    setTokenIdContext(null)
    setKeyIdContext(null)
  }

  const processFile = async (
    file: File,
    source: DocumentDroppedSource = 'file_picker'
  ) => {
    const currentId = ++verificationIdRef.current
    setFileName(file.name)
    setVerifyStatus('verifying')
    setFragments([])
    setPendingDoc(null)
    clearVerificationMetadata()

    trackDocumentDropped(file.name, source)

    let parsedDoc: any
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (isPdf(bytes)) {
        // Verifiable PDF: extract the embedded credential and run the carrier
        // (visual-layer integrity) check before handing the credential to the
        // existing TrustVC pipeline. Non-PDFs fall through to the JSON path below,
        // byte-identical to the pre-patch behavior.
        const carrierResult = await checkVerifiablePdf(bytes)
        if (!carrierResult.hasCredential) {
          clearVerificationMetadata()
          setCarrier(carrierResult)
          setErrorType(errorMessages.TYPES.INVALID)
          setErrorMessage(
            'This is a regular PDF — no embedded credential was found.'
          )
          setVerifyStatus('error')
          trackDocumentVerifyError(undefined, errorMessages.TYPES.INVALID)
          return
        }
        if (carrierResult.error === 'EMBEDDED_CREDENTIAL_CORRUPTED') {
          clearVerificationMetadata()
          setCarrier(carrierResult)
          setErrorType(errorMessages.TYPES.INVALID)
          setErrorMessage('The embedded credential in this PDF is corrupted.')
          setVerifyStatus('error')
          trackDocumentVerifyError(undefined, errorMessages.TYPES.INVALID)
          return
        }
        setCarrier(carrierResult)
        parsedDoc = carrierResult.vc
      } else {
        setCarrier(null)
        const text = new TextDecoder().decode(bytes)
        parsedDoc = JSON.parse(text)
      }
      // Prefer the document's own chain; fall back to its embedded network field
      // (getChainId ignores that for DNS-DID/DID docs, which can still use a
      // REVOCATION_STORE on that chain) before asking the user to pick one.
      const chainId = getChainId(parsedDoc) ?? getEmbeddedChainId(parsedDoc)

      if (!chainId && requiresNetworkSelection(parsedDoc)) {
        // Needs blockchain verification but has no chain anywhere — ask the user
        setPendingDoc(parsedDoc)
        setVerifyStatus('network-select')
        trackNetworkSelectionShown(parsedDoc)
        return
      }

      captureVerificationBreadcrumb('Verification started', {
        fileName: file.name,
        source: 'file',
      })
      await runVerification(parsedDoc, chainId, currentId, file.name)
    } catch (err) {
      if (currentId !== verificationIdRef.current) return
      const errType = getErrorTypeFromError(err)
      clearVerificationMetadata()
      setErrorType(errType)
      setVerifyStatus('error')
      captureVerificationException(err, {
        stage: 'processFile',
        fileName: file.name,
      })
      trackDocumentVerifyError(parsedDoc, errType)
    }
  }

  const handleNetworkConfirm = async (chainId: string) => {
    if (!pendingDoc) return
    const currentId = ++verificationIdRef.current
    setVerifyStatus('verifying')
    const docRef = pendingDoc
    trackNetworkSelected(chainId)
    try {
      captureVerificationBreadcrumb('Verification started', {
        fileName,
        source: 'file',
      })
      await runVerification(pendingDoc, chainId, currentId, fileName)
    } catch (err) {
      if (currentId !== verificationIdRef.current) return
      const errType = getErrorTypeFromError(err)
      clearVerificationMetadata()
      setErrorType(errType)
      setVerifyStatus('error')
      captureVerificationException(err, {
        stage: 'handleNetworkConfirm',
        fileName,
        chainId,
      })
      trackDocumentVerifyError(docRef, errType)
    } finally {
      setPendingDoc(null)
    }
  }

  const handleNetworkCancel = () => {
    trackNetworkSelectionCancelled()
    setVerifyStatus('idle')
    setFileName('')
    setPendingDoc(null)
    clearVerificationMetadata()
  }

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0], 'drop')
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0], 'file_picker')
      e.target.value = ''
    }
  }

  const loadDocument = async (
    doc: unknown,
    chainId: string | null | undefined,
    name: string,
    source: DocumentDroppedSource = 'url'
  ) => {
    const currentId = ++verificationIdRef.current
    setFileName(name)
    setVerifyStatus('verifying')
    setFragments([])
    setPendingDoc(null)
    clearVerificationMetadata()

    captureVerificationBreadcrumb('Verification started', {
      fileName: name,
      source: 'url',
    })
    trackDocumentDropped(name, source)

    try {
      await runVerification(doc, chainId, currentId, name)
    } catch (err) {
      if (currentId !== verificationIdRef.current) return
      const errType = getErrorTypeFromError(err)
      clearVerificationMetadata()
      setErrorType(errType)
      setVerifyStatus('error')
      captureVerificationException(err, {
        stage: 'loadDocument',
        fileName: name,
        chainId,
      })
      trackDocumentVerifyError(doc, errType)
    }
  }

  const handleReset = () => {
    trackVerificationReset()
    setVerifyStatus('idle')
    setFragments([])
    setFileName('')
    setErrorType(errorMessages.TYPES.VERIFICATION_ERROR)
    setPendingDoc(null)
    clearVerificationMetadata()
  }

  const getGroupStatus = (type: string) => computeGroupStatus(fragments, type)

  return {
    verifyStatus,
    fileName,
    errorType,
    errorMessage,
    dragActive,
    verifiedChainId,
    issuerName,
    isTransferable,
    isExpired,
    tokenRegistryVersion,
    tokenRegistryAddress,
    tags,
    tokenId,
    keyId,
    rawDocument,
    carrier,
    getGroupStatus,
    handleDrag,
    handleDrop,
    handleFileInput,
    handleReset,
    handleNetworkConfirm,
    handleNetworkCancel,
    loadDocument,
  }
}
