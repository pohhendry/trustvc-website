import React from 'react'
import { useVerify } from './useVerify'
import { ActionLoader } from './ActionLoader'
import NetworkModal from './NetworkModal'
import VerifyResult from './VerifyResult'
import VerifyError from './VerifyError'
import CarrierPanel from './CarrierPanel'
import EndorsementChain from '../EndorsementChain'
import { useEndorsementChain } from '../EndorsementChain/useEndorsementChain'
import Spinner from '../../icons/Spinner'
import { getAttachments, isValidAttachmentData } from '../../../utils/helper'
import { useOverlayContext } from '../../common/contexts/OverlayContext'
import ConnectToBlockchainModel from '../../ConnectToBlockchain'
import { UploadIcon } from 'lucide-react'
import { ButtonSize, LabelButton } from '../../../components/common/Button'

interface VerifySectionProps {
  isDarkMode: boolean
  showDemoCta?: boolean
}

const CHAIN_NAMES: Record<string, string> = {
  '1': 'Ethereum',
  '137': 'Polygon (POL)',
  '50': 'XDC Network',
  '101010': 'Stability (Beta)',
  '1338': 'Astron',
  '11155111': 'Sepolia',
  '80002': 'Polygon Amoy',
  '51': 'Apothem',
  '20180427': 'Stability Testnet (Beta)',
  '21002': 'Astron Testnet',
}

const VerifySection: React.FC<VerifySectionProps> = ({
  isDarkMode,
  showDemoCta = true,
}) => {
  const {
    verifyStatus,
    fileName,
    errorType,
    errorMessage,
    dragActive,
    verifiedChainId,
    issuerName,
    isTransferable,
    isExpired,
    tokenRegistryAddress,
    tokenRegistryVersion,
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
  } = useVerify()
  const { showOverlay, closeOverlay } = useOverlayContext()
  const handleConnectWallet = async () => {
    showOverlay(<ConnectToBlockchainModel onClose={closeOverlay} />)
  }
  // Fetch endorsement chain data only when file is verified as valid and transferable
  const isValidTransferable =
    verifyStatus === 'valid' && isTransferable === true
  const {
    endorsementChain,
    endorsementChainStatus,
    showEndorsementChain,
    handleShowEndorsementChain,
    handleHideEndorsementChain,
    refreshEndorsementChain,
  } = useEndorsementChain({
    tokenRegistryAddress: isValidTransferable
      ? tokenRegistryAddress
      : undefined,
    tokenId: isValidTransferable ? tokenId : undefined,
    verifiedChainId: isValidTransferable ? verifiedChainId : undefined,
    keyId: isValidTransferable ? keyId : undefined,
  })

  const invalidAttachments = React.useMemo(() => {
    if (!rawDocument) return []
    const attachments = getAttachments(rawDocument)
    return attachments.filter(
      att =>
        typeof att.data !== 'string' ||
        !att.data ||
        !isValidAttachmentData(att.data, att.type)
    )
  }, [rawDocument])

  const networkName = verifiedChainId
    ? (CHAIN_NAMES[verifiedChainId] ?? `Chain ${verifiedChainId}`)
    : undefined

  const renderDropzone = () => (
    <div className="frame-dropbox">
      <div
        className={`dropbox-area dropbox-area--home ${dragActive ? 'drag-active' : ''}`}
        data-testid="dropzone"
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <div className="frame-dropbox-text">
          <div className="dropbox-text">Drop TrustVC files here to verify</div>
        </div>
        <div className="frame-divider">
          <div className="divider-text">or</div>
        </div>
        <LabelButton
          htmlFor="file-upload"
          btnType="solid"
          size={ButtonSize.FLEX}
          className="!max-w-[135px]"
        >
          {' '}
          <div className="flex flex-row items-center gap-2">
            <UploadIcon />
            <h5>Browse Files</h5>
          </div>
        </LabelButton>
        <input
          id="file-upload"
          type="file"
          accept=".json,.tt,.oa,.pdf"
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />
      </div>
      <div className="frame-file-info">
        <div className="file-info-text">
          Maximum 10 MB. Supported files include .tt, .oa, and .json.
        </div>
      </div>
    </div>
  )

  const renderVerifying = () => (
    <div className="frame-dropbox">
      <div
        className="dropbox-area dropbox-area--home dropbox-area--centered"
        data-testid="verifying-state"
      >
        <div className="flex flex-col items-center gap-2">
          <Spinner fontSize={32} />
          <span className="text-sm">Verifying {fileName}...</span>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <ActionLoader loadDocument={loadDocument} />
      <div
        className={`min-w-[360px] max-w-[1440px] verify-section ${isDarkMode ? 'dark-mode' : ''}`}
      >
        <div className="boundary-frame">
          {showEndorsementChain && (
            <EndorsementChain
              endorsementChain={endorsementChain}
              onReset={handleHideEndorsementChain}
              onRetry={refreshEndorsementChain}
              isDarkMode={isDarkMode}
              endorsementChainStatus={endorsementChainStatus}
              tokenRegistryVersion={tokenRegistryVersion}
            />
          )}
          <div className="overlay-border-shadow">
            <div className="frame-container">
              {verifyStatus === 'idle' && renderDropzone()}
              {verifyStatus === 'verifying' && renderVerifying()}
              {verifyStatus === 'network-select' && renderDropzone()}
              {verifyStatus === 'valid' && (
                <VerifyResult
                  fileName={fileName}
                  networkName={networkName}
                  chainId={verifiedChainId}
                  tokenId={tokenId}
                  issuer={issuerName}
                  isTransferable={isTransferable}
                  tokenRegistryAddress={tokenRegistryAddress}
                  tags={tags}
                  rawDocument={rawDocument}
                  invalidAttachments={invalidAttachments}
                  isExpired={isExpired}
                  getGroupStatus={getGroupStatus}
                  onReset={handleReset}
                  onViewEndorsementChain={handleShowEndorsementChain}
                  refreshEndorsementChain={refreshEndorsementChain}
                  onConnectWallet={handleConnectWallet}
                />
              )}

              {(verifyStatus === 'invalid' || verifyStatus === 'error') && (
                <VerifyError
                  errorType={errorType}
                  message={errorMessage}
                  onReset={handleReset}
                />
              )}
              {(verifyStatus === 'valid' ||
                verifyStatus === 'invalid' ||
                verifyStatus === 'error') && <CarrierPanel carrier={carrier} />}
              {verifyStatus === 'network-select' && (
                <NetworkModal
                  isDarkMode={isDarkMode}
                  fileName={fileName}
                  onConfirm={handleNetworkConfirm}
                  onCancel={handleNetworkCancel}
                />
              )}
              {showDemoCta && (
                <div className="demo-button">
                  <div className="demo-content">
                    <div className="demo-text-wrapper">
                      <div className="demo-heading">Try our demo document!</div>
                    </div>
                    <div className="demo-description-wrapper">
                      <div className="demo-description">
                        Experience the interoperability of our documents from
                        the documents gallery!
                      </div>
                    </div>
                  </div>
                  <div className="cta-button-wrapper">
                    <button
                      type="button"
                      className="cta-button"
                      onClick={() =>
                        window.open(
                          'https://gallery.tradetrust.io',
                          '_blank',
                          'noopener,noreferrer'
                        )
                      }
                    >
                      <div className="cta-boundary">
                        <div className="cta-padding" />
                        <div className="cta-text-frame">
                          <div className="cta-label">
                            Visit Document Gallery
                          </div>
                        </div>
                        <div className="cta-padding" />
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default VerifySection
