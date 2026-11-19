/**
 * PDFs of notes (docs/ai-assistant-v1.md 4.9.2), read on the device with pdf.js: the text layer of
 * every page, and each page drawn as a picture (shown next to its text, and read by the model when
 * the page has fewer than 20 letters or digits of text, or the person picks "Read as image").
 *
 * Loaded only when a PDF is added (its own chunk). The page's CSP allows scripts from the app only:
 * the worker is a file of the build and the WebAssembly image decoders are off, so
 * pdf.js uses its script decoders.
 */
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { drawAsJpeg, scaledSize, type PreparedImage } from './images'
import { AI_LIMITS } from '../../../shared/ai/contract'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface PdfPage {
  /** The text layer, lines kept. */
  text: string
  /** The page drawn, or null when drawing failed. */
  image: PreparedImage | null
  /** Too little text: the page is read from its picture. */
  needsImage: boolean
}

export type PdfResult = { ok: true; pages: PdfPage[]; more: boolean } | { ok: false; problem: 'password' | 'unreadable' }

/** Fewer letters or digits than this and a PDF page is read from its picture (4.9.2). */
export const MIN_TEXT_CHARS = 20

export function hasEnoughText(text: string): boolean {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length >= MIN_TEXT_CHARS
}

/** The text of a page's text items: a line break where pdf.js marks the end of a line. */
export function joinTextItems(items: ReadonlyArray<{ str?: string; hasEOL?: boolean }>): string {
  let text = ''
  for (const item of items) {
    if (typeof item.str === 'string') text += item.str
    if (item.hasEOL) text += '\n'
  }
  return text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export async function readPdf(bytes: Uint8Array, maxPages: number = AI_LIMITS.notes_pages_max): Promise<PdfResult> {
  let doc: pdfjs.PDFDocumentProxy
  try {
    doc = await pdfjs.getDocument({ data: bytes.slice(), useWasm: false }).promise
  } catch (err) {
    const name = (err as { name?: string } | null)?.name
    return { ok: false, problem: name === 'PasswordException' ? 'password' : 'unreadable' }
  }
  try {
    const pages: PdfPage[] = []
    const count = Math.min(doc.numPages, maxPages)
    for (let i = 1; i <= count; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const text = joinTextItems(content.items as Array<{ str?: string; hasEOL?: boolean }>)
      let image: PreparedImage | null = null
      try {
        const base = page.getViewport({ scale: 1 })
        const target = scaledSize(base.width * 3, base.height * 3)
        const viewport = page.getViewport({ scale: target.width / base.width })
        const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
        const context = canvas.getContext('2d')
        if (context) {
          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, canvas.width, canvas.height)
          await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise
          image = await drawAsJpeg(canvas, canvas.width, canvas.height)
        }
      } catch {
        image = null
      }
      pages.push({ text, image, needsImage: !hasEnoughText(text) })
      page.cleanup()
    }
    return { ok: true, pages, more: doc.numPages > count }
  } finally {
    void doc.destroy()
  }
}
