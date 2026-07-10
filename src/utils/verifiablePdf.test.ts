import { describe, it, expect, beforeAll, inject } from 'vitest'
import * as pdfjs from 'pdfjs-dist'
import { checkVerifiablePdf, isPdf } from './verifiablePdf'

// jsdom-missing DOM/JS globals that pdfjs v6 needs are polyfilled in
// src/setupTests.ts (runs before this module loads).
//
// The base vite config polyfills fs/path/url for the browser bundle, so we
// cannot read files from disk in-test. The fixture PDFs are read (as base64) in
// vitest.pdf.config.ts — which runs in real Node — and handed over via
// `provide`/`inject`.
const b64ToBytes = (b64: string): Uint8Array =>
  Uint8Array.from(atob(b64), c => c.charCodeAt(0))
const fixtures: Record<string, string> = {
  'certificate.pdf': inject('certificatePdfB64' as never),
  'certificate-preview.pdf': inject('plainPdfB64' as never),
}

const read = (name: string): Uint8Array => b64ToBytes(fixtures[name])

beforeAll(async () => {
  // Run pdfjs on the main thread — jsdom has no real Worker. pdfjs still needs a
  // workerSrc string to set up its fake (main-thread) worker; point it at the
  // real worker module so pdfjs can import it in-process.
  ;(globalThis as any).Worker = undefined
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url'))
    .default as string
  ;(pdfjs.GlobalWorkerOptions as any).workerSrc = workerUrl
})

describe('verifiablePdf carrier check', () => {
  it('isPdf detects the PDF magic header', () => {
    expect(isPdf(read('certificate.pdf'))).toBe(true)
    expect(isPdf(new Uint8Array([0x7b, 0x7d]))).toBe(false) // "{}"
  })

  it('extracts the embedded credential and confirms visual-layer integrity for a Verifiable PDF', async () => {
    const result = await checkVerifiablePdf(read('certificate.pdf'))
    expect(result.hasCredential).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.vc?.pdfBinding?.byteLength).toBeTypeOf('number')
    expect(result.visualLayerIntact).toBe(true)
    expect(result.modifiedAfterSigning).toBe(false)
    expect(result.baseBytes).toBeInstanceOf(Uint8Array)
  })

  it('reports no credential for a plain PDF', async () => {
    const result = await checkVerifiablePdf(read('certificate-preview.pdf'))
    expect(result.hasCredential).toBe(false)
    expect(result.vc).toBeUndefined()
  })

  it('flags tampering when trailing bytes are appended after signing', async () => {
    const original = read('certificate.pdf')
    const tampered = new Uint8Array(original.length + 4)
    tampered.set(original, 0)
    tampered.set([0x0a, 0x25, 0x25, 0x0a], original.length) // append junk
    const result = await checkVerifiablePdf(tampered)
    // Extra bytes beyond byteLength don't change the base-slice digest, but the
    // deterministic reconstruction no longer matches → modifiedAfterSigning.
    expect(result.hasCredential).toBe(true)
    expect(result.visualLayerIntact).toBe(true)
    expect(result.modifiedAfterSigning).toBe(true)
  })
})
