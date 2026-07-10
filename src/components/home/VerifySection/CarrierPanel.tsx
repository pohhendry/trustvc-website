import { useEffect, useMemo } from 'react'
import type { CarrierCheck } from '../../../utils/verifiablePdf'

export default function CarrierPanel({
  carrier,
}: {
  carrier: CarrierCheck | null
}) {
  const url = useMemo(
    () =>
      carrier?.baseBytes && carrier.visualLayerIntact
        ? URL.createObjectURL(
            new Blob([carrier.baseBytes as BlobPart], {
              type: 'application/pdf',
            })
          )
        : null,
    [carrier]
  )
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url)
    },
    [url]
  )
  if (!carrier?.hasCredential) return null

  return (
    <div
      style={{
        marginTop: 16,
        border: '1px solid #d4d4d8',
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
        {carrier.visualLayerIntact && !carrier.modifiedAfterSigning ? (
          <span style={{ color: '#15803d' }}>
            ✓ Visual layer integrity (carrier check — signed PDF bytes match)
          </span>
        ) : carrier.visualLayerIntact && carrier.modifiedAfterSigning ? (
          <span style={{ color: '#b45309' }}>
            ⚠ This file was modified after signing. Only the signed view below
            is attested.
          </span>
        ) : (
          <span style={{ color: '#b91c1c' }}>
            ✗ The credential is authentic, but the visible document has been
            altered — trust only the verified data shown by this verifier.
          </span>
        )}
      </div>
      <p style={{ fontSize: 12, color: '#71717a', margin: '4px 0 12px' }}>
        This is a carrier-level check performed by this site, separate from the
        TrustVC verification fragments above.
      </p>
      {url ? (
        <>
          <p style={{ fontSize: 12, color: '#3f3f46', marginBottom: 6 }}>
            The document as signed by the issuer:
          </p>
          <iframe
            title="Signed document"
            src={url}
            style={{
              width: '100%',
              height: 480,
              border: '1px solid #e4e4e7',
            }}
          />
        </>
      ) : (
        carrier.vc?.credentialSubject && (
          <pre
            style={{
              fontSize: 12,
              background: '#fafafa',
              padding: 12,
              overflowX: 'auto',
            }}
          >
            {JSON.stringify(carrier.vc.credentialSubject, null, 2)}
          </pre>
        )
      )}
    </div>
  )
}
