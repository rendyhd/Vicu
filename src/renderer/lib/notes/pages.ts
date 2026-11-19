/**
 * The pages of open notes (docs/ai-assistant-v1.md 4.9): what each source becomes, and the rules
 * the notes screen reads off them (which pages still need reading, the transcript sent to the model,
 * the notes' date from the first file). Pure except `pagesFromFile`, which draws pictures and reads
 * PDFs.
 */
import type { NotesPage } from '../../../shared/ai/notes'
import type { NotesFile } from '../../../shared/notes-import-types'
import { prepareImage } from './images'

export type NotesPageKind = 'text' | 'pdf' | 'image'

/** `ready`: has its text; `unread`: a picture not read yet; `reading`; `failed` (with `error`). */
export type NotesPageStatus = 'ready' | 'unread' | 'reading' | 'failed'

export interface NotesSourcePage {
  id: string
  /** The file it came from, or empty for typed or pasted text and pictures. */
  source: string
  kind: NotesPageKind
  /** The page's text: typed, from the file, the PDF's text layer, or read from the picture. */
  text: string
  /** Base64 JPEG of the page (a picture, or a PDF page drawn), or null. */
  image: string | null
  status: NotesPageStatus
  error?: string
  /** A PDF page: its own text layer, to go back to from "Read as image". */
  layerText?: string
  /** A PDF page read from its picture instead of its text layer. */
  asImage?: boolean
}

/** Why a file gave no page (shown by name). */
export type NotesFileIssue = { name: string; problem: 'type' | 'size' | 'heic' | 'unreadable' | 'password' | 'image' | 'more' }

let counter = 0
export function newPageId(): string {
  counter += 1
  return `page-${Date.now().toString(36)}-${counter}`
}

export function textPage(text: string, source = ''): NotesSourcePage {
  return { id: newPageId(), source, kind: 'text', text: text.replace(/\r\n?/g, '\n').trim(), image: null, status: 'ready' }
}

export function imagePage(image: string, source = ''): NotesSourcePage {
  return { id: newPageId(), source, kind: 'image', text: '', image, status: 'unread' }
}

const decoder = new TextDecoder('utf-8')

/** The pages a picked file gives, or why it gives none. */
export async function pagesFromFile(file: NotesFile): Promise<{ pages: NotesSourcePage[]; issue?: NotesFileIssue; more?: boolean }> {
  if (file.problem || !file.bytes) return { pages: [], issue: { name: file.name, problem: file.problem ?? 'unreadable' } }
  if (file.type === 'text/plain' || file.type === 'text/markdown') {
    const text = decoder.decode(file.bytes).replace(/^﻿/, '')
    return text.trim() ? { pages: [textPage(text, file.name)] } : { pages: [] }
  }
  if (file.type === 'application/pdf') {
    const { readPdf } = await import('./pdf')
    const result = await readPdf(file.bytes)
    if (!result.ok) return { pages: [], issue: { name: file.name, problem: result.problem } }
    const pages = result.pages.map((page): NotesSourcePage => {
      const image = page.image?.data ?? null
      if (page.needsImage && image) return { id: newPageId(), source: file.name, kind: 'pdf', text: '', image, status: 'unread', layerText: page.text, asImage: true }
      return { id: newPageId(), source: file.name, kind: 'pdf', text: page.text, image, status: 'ready', layerText: page.text }
    }).filter((page) => page.image !== null || page.text !== '')
    return { pages, more: result.more }
  }
  if (file.type.startsWith('image/')) {
    try {
      const prepared = await prepareImage(new Blob([file.bytes.slice()], { type: file.type }))
      return { pages: [imagePage(prepared.data, file.name)] }
    } catch {
      return { pages: [], issue: { name: file.name, problem: 'image' } }
    }
  }
  return { pages: [], issue: { name: file.name, problem: 'type' } }
}

/** A dropped or pasted file, as main would give it. */
export async function notesFileOfBlob(blob: Blob, name: string): Promise<NotesFile> {
  const lower = name.toLowerCase()
  const type = blob.type
    || (lower.endsWith('.pdf') ? 'application/pdf' : lower.endsWith('.md') || lower.endsWith('.markdown') ? 'text/markdown' : lower.endsWith('.txt') ? 'text/plain' : '')
  if (!type || !(type.startsWith('image/') || type === 'application/pdf' || type.startsWith('text/'))) return { name, type, problem: 'type' }
  if (type === 'image/heic' || type === 'image/heif') return { name, type, problem: 'heic' }
  return { name, type: type.startsWith('text/') && type !== 'text/markdown' ? 'text/plain' : type, bytes: new Uint8Array(await blob.arrayBuffer()), modified: (blob as File).lastModified }
}

/** "Read as image" on a PDF page, or back to its text layer. */
export function withPdfMode(page: NotesSourcePage, asImage: boolean): NotesSourcePage {
  if (page.kind !== 'pdf' || !page.image) return page
  if (asImage) return { ...page, asImage: true, text: '', status: 'unread', error: undefined }
  return { ...page, asImage: false, text: page.layerText ?? '', status: 'ready', error: undefined }
}

/** The pages that still need reading by a model. */
export function unreadPages(pages: readonly NotesSourcePage[]): NotesSourcePage[] {
  return pages.filter((page) => page.status === 'unread' || page.status === 'failed')
}

/** The transcript sent to the model (4.9.3): every page with text, numbered by its place. */
export function transcriptPages(pages: readonly NotesSourcePage[]): NotesPage[] {
  return pages
    .map((page, index) => ({ n: index + 1, text: page.status === 'ready' ? page.text.trim() : '' }))
    .filter((page) => page.text !== '')
}

/** Moves a page one place up or down. */
export function movedPage(pages: readonly NotesSourcePage[], id: string, delta: -1 | 1): NotesSourcePage[] {
  const from = pages.findIndex((page) => page.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= pages.length) return [...pages]
  const next = [...pages]
  const [page] = next.splice(from, 1)
  next.splice(to, 0, page)
  return next
}
