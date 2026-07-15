import { PDFDocument, PDFDict, PDFName, PDFRef } from 'pdf-lib'

export const ATTACHMENT_NAME = 'trustvc-credential.json'

/** Offset of the last cross-reference section, read from the trailing `startxref`. */
export function findLastStartXref(bytes: Uint8Array): number {
  const tail = new TextDecoder('latin1').decode(
    bytes.slice(Math.max(0, bytes.length - 2048))
  )
  const idx = tail.lastIndexOf('startxref')
  if (idx === -1) throw new Error('startxref not found — not a valid PDF tail')
  const m = /startxref\s+(\d+)/.exec(tail.slice(idx))
  if (!m) throw new Error('malformed startxref')
  return Number(m[1])
}

function buildXrefSection(offsets: Map<number, number>): string {
  const nums = [...offsets.keys()].sort((a, b) => a - b)
  const runs: number[][] = []
  for (const n of nums) {
    const last = runs[runs.length - 1]
    if (last && n === last[last.length - 1] + 1) last.push(n)
    else runs.push([n])
  }
  let out = 'xref\n'
  for (const run of runs) {
    out += `${run[0]} ${run.length}\n`
    for (const n of run)
      out += `${String(offsets.get(n)!).padStart(10, '0')} 00000 n \n`
  }
  return out
}

/**
 * Appends `vcBytes` as an embedded file (ATTACHMENT_NAME) via a PDF incremental
 * update. Bytes 0..basePdf.length-1 of the result are byte-identical to basePdf.
 * Deterministic: same inputs → same output (the reconstruction check relies on it).
 * Requires a base with a classic xref table (save({useObjectStreams:false}))
 * and no existing /Names catalog entry — both true for our renderer's output.
 */
export async function appendVcAttachment(
  basePdf: Uint8Array,
  vcBytes: Uint8Array
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(basePdf, { updateMetadata: false })
  const rootRef = doc.context.trailerInfo.Root as PDFRef
  const catalog = doc.context.lookup(rootRef, PDFDict)
  if (catalog.has(PDFName.of('Names'))) {
    throw new Error(
      'base PDF already has a /Names entry — appender assumes none'
    )
  }
  const largest = doc.context.largestObjectNumber
  const prevStartXref = findLastStartXref(basePdf)

  const n1 = largest + 1 // EmbeddedFile stream
  const n2 = largest + 2 // Filespec
  const n3 = largest + 3 // EmbeddedFiles name tree
  const catalogNum = rootRef.objectNumber

  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  let cursor = basePdf.length
  const push = (s: string | Uint8Array) => {
    const b = typeof s === 'string' ? enc.encode(s) : s
    parts.push(b)
    cursor += b.length
  }
  const offsets = new Map<number, number>()

  push('\n')
  offsets.set(n1, cursor)
  push(
    `${n1} 0 obj\n<< /Type /EmbeddedFile /Subtype /application#2Fjson /Length ${vcBytes.length} >>\nstream\n`
  )
  push(vcBytes)
  push('\nendstream\nendobj\n')

  offsets.set(n2, cursor)
  push(
    `${n2} 0 obj\n<< /Type /Filespec /F (${ATTACHMENT_NAME}) /UF (${ATTACHMENT_NAME}) ` +
      `/EF << /F ${n1} 0 R >> >>\nendobj\n`
  )

  offsets.set(n3, cursor)
  push(`${n3} 0 obj\n<< /Names [ (${ATTACHMENT_NAME}) ${n2} 0 R ] >>\nendobj\n`)

  // Redefine the catalog: original entries + /Names pointing at our tree.
  const entries: string[] = []
  for (const [key, value] of catalog.entries()) {
    entries.push(`${key.toString()} ${value.toString()}`)
  }
  entries.push(`/Names << /EmbeddedFiles ${n3} 0 R >>`)
  offsets.set(catalogNum, cursor)
  push(`${catalogNum} 0 obj\n<< ${entries.join(' ')} >>\nendobj\n`)

  const xrefOffset = cursor
  push(buildXrefSection(offsets))
  push(
    `trailer\n<< /Size ${n3 + 1} /Root ${catalogNum} 0 R /Prev ${prevStartXref} >>\n`
  )
  push(`startxref\n${xrefOffset}\n%%EOF\n`)

  const out = new Uint8Array(cursor)
  out.set(basePdf, 0)
  let at = basePdf.length
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
