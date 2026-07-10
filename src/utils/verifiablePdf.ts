import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { appendVcAttachment, ATTACHMENT_NAME } from './appendAttachment'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface CarrierCheck {
  hasCredential: boolean
  vc?: any
  raw?: Uint8Array
  baseBytes?: Uint8Array
  visualLayerIntact?: boolean
  modifiedAfterSigning?: boolean
  error?: 'EMBEDDED_CREDENTIAL_CORRUPTED' | 'NO_PDF_BINDING' | 'BAD_BYTE_LENGTH'
}

export function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  )
}

async function digestHex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(d)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function extractVc(
  bytes: Uint8Array
): Promise<{ vc: any; raw: Uint8Array } | null> {
  const loadingTask = pdfjs.getDocument({ data: bytes.slice() })
  const doc = await loadingTask.promise
  try {
    // pdfjs-dist v6: getAttachments() returns a Map<string, { filename, rawFilename,
    // description }> WITHOUT eager content — the content must be fetched lazily via
    // getAttachmentContent(key). (v4 used to hand back { filename, content } objects.)
    const attachments = (await doc.getAttachments()) as Map<
      string,
      { filename: string }
    > | null
    if (!attachments) return null
    let matchKey: string | null = null
    for (const [key, meta] of attachments) {
      if (meta.filename === ATTACHMENT_NAME || key === ATTACHMENT_NAME) {
        matchKey = key
        break
      }
    }
    if (matchKey === null) return null
    const content = (await doc.getAttachmentContent(
      matchKey
    )) as Uint8Array | null
    if (!content) return null
    const raw = new Uint8Array(content)
    try {
      return { vc: JSON.parse(new TextDecoder().decode(raw)), raw }
    } catch {
      throw new Error('EMBEDDED_CREDENTIAL_CORRUPTED')
    }
  } finally {
    // v6: destroy() lives on the loading task, not the document proxy.
    await loadingTask.destroy()
  }
}

export async function checkVerifiablePdf(
  fileBytes: Uint8Array
): Promise<CarrierCheck> {
  let extraction
  try {
    extraction = await extractVc(fileBytes)
  } catch (err) {
    if (
      err instanceof Error &&
      err.message === 'EMBEDDED_CREDENTIAL_CORRUPTED'
    ) {
      return { hasCredential: true, error: 'EMBEDDED_CREDENTIAL_CORRUPTED' }
    }
    throw err
  }
  if (!extraction) return { hasCredential: false }
  const { vc, raw } = extraction
  const binding = vc?.pdfBinding
  if (!binding?.digest || typeof binding.byteLength !== 'number') {
    return { hasCredential: true, vc, raw, error: 'NO_PDF_BINDING' }
  }
  const n = binding.byteLength
  if (n <= 0 || n >= fileBytes.length) {
    return {
      hasCredential: true,
      vc,
      raw,
      visualLayerIntact: false,
      error: 'BAD_BYTE_LENGTH',
    }
  }
  const baseBytes = fileBytes.slice(0, n)
  const visualLayerIntact = (await digestHex(baseBytes)) === binding.digest
  let modifiedAfterSigning = false
  if (visualLayerIntact) {
    const expected = await appendVcAttachment(baseBytes, raw)
    modifiedAfterSigning =
      expected.length !== fileBytes.length ||
      !expected.every((b, i) => b === fileBytes[i])
  }
  return {
    hasCredential: true,
    vc,
    raw,
    baseBytes,
    visualLayerIntact,
    modifiedAfterSigning,
  }
}
