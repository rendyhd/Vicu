import type { Handle } from '../main/handlers/types'
import { checkUploadSize, downloadTaskAttachment } from '../main/api-client'
import { isRiskyAttachment, sanitizeAttachmentFileName } from '../main/attachment-safety'
import { importPreview } from '../main/calendar/ics-import'
import { readUploadAnswer } from '../shared/attachment-upload'
import { toLocalDate } from '../shared/due-dates'
import doneSoundUrl from '../../resources/done.mp3?url'
import { osPlatform } from './host/env'
import { invoke } from './registry'

// Files, the clipboard and printing, with what a browser has: a file input instead of the open
// dialog, a download instead of "open in the default app", the Clipboard API, a hidden frame for
// printing. A file's bytes only ever come from the user's own pick or from the server.

// --- Picking files ----------------------------------------------------------------------------

/** Ask for files with the browser's own picker. Resolves with none when the user backs out. */
function pickFiles(options: { multiple: boolean; accept?: string }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = options.multiple
    if (options.accept) input.accept = options.accept
    input.style.display = 'none'
    let settled = false
    const finish = (files: File[]): void => {
      if (settled) return
      settled = true
      window.removeEventListener('focus', onFocus)
      input.remove()
      resolve(files)
    }
    // Browsers without the `cancel` event say nothing when the picker is closed: the window
    // getting its focus back without a choice, a moment later, is read as backing out.
    const onFocus = (): void => {
      window.setTimeout(() => {
        if (!input.files?.length) finish([])
      }, 1000)
    }
    input.addEventListener('change', () => finish(input.files ? [...input.files] : []))
    input.addEventListener('cancel', () => finish([]))
    window.addEventListener('focus', onFocus)
    document.body.appendChild(input)
    input.click()
  })
}

/** Files picked for a task, held between the pick and their uploads; the page names one by its token. */
const TOKEN_TTL_MS = 10 * 60_000
const picked = new Map<string, { file: File; at: number }>()

function rememberPicked(files: File[]): { token: string; name: string; size: number }[] {
  const now = Date.now()
  for (const [token, held] of picked) if (now - held.at > TOKEN_TTL_MS) picked.delete(token)
  return files.map((file) => {
    const token = crypto.randomUUID()
    picked.set(token, { file, at: now })
    return { token, name: file.name, size: file.size }
  })
}

type Sent = { kind: 'uploaded'; attachments: unknown[] } | { kind: 'failed'; error: string }

async function uploadFile(taskId: number, file: File): Promise<Sent> {
  // The size is checked against the server's limit before the file is read into memory.
  const tooLarge = await checkUploadSize(file.size)
  if (tooLarge) return { kind: 'failed', error: tooLarge }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return { kind: 'failed', error: 'The file could not be read' }
  }
  // Through the shared handler, so the upload takes its turn among the task's other writes.
  const result = await invoke('upload-task-attachment', taskId, bytes, file.name, file.type || 'application/octet-stream') as
    { success: true; data: unknown } | { success: false; error: string }
  if (!result.success) return { kind: 'failed', error: result.error }
  // The server answers 201 even for a file it refused.
  const answer = readUploadAnswer(result.data)
  if (answer.error && answer.attachments.length === 0) return { kind: 'failed', error: answer.error }
  return { kind: 'uploaded', attachments: answer.attachments }
}

// --- Saving and opening -----------------------------------------------------------------------

/** The types a browser shows itself and that cannot run script on this origin. Never HTML or SVG. */
const SHOWN_IN_A_TAB: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain;charset=utf-8',
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function blobUrl(bytes: Uint8Array, type: string): string {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type }))
  // Long enough for a download to start or a tab to load it.
  window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000)
  return url
}

function download(bytes: Uint8Array, name: string): void {
  const link = document.createElement('a')
  // A type the browser never shows or runs: the file is only ever written to disk.
  link.href = blobUrl(bytes, 'application/octet-stream')
  link.download = name
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

// --- Clipboard --------------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47]

async function asPng(bytes: Uint8Array): Promise<Blob | null> {
  if (PNG_SIGNATURE.every((byte, at) => bytes[at] === byte)) return new Blob([bytes.slice()], { type: 'image/png' })
  try {
    const bitmap = await createImageBitmap(new Blob([bytes.slice()]))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    bitmap.close()
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  } catch {
    return null
  }
}

// --- Printing ---------------------------------------------------------------------------------

type PrintResult = { success: true } | { success: false; error: string }

let printing = false

/** Print a prepared document from a hidden frame; scripts in it never run. */
function printHtml(html: string): Promise<PrintResult> {
  if (printing) return Promise.resolve({ success: false, error: 'A print job is already in progress' })
  printing = true
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    let done = false
    const finish = (result: PrintResult): void => {
      if (done) return
      done = true
      printing = false
      // Some browsers return from print() before the dialog closes: the frame stays a while.
      window.setTimeout(() => frame.remove(), 60_000)
      resolve(result)
    }
    frame.addEventListener('load', () => {
      const target = frame.contentWindow
      if (!target) return finish({ success: false, error: 'Print failed' })
      try {
        target.focus()
        target.print()
        finish({ success: true })
      } catch (err) {
        finish({ success: false, error: err instanceof Error ? err.message : 'Print failed' })
      }
    })
    window.setTimeout(() => finish({ success: false, error: 'Print failed' }), 15_000)
    frame.srcdoc = html
    document.body.appendChild(frame)
  })
}

const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value)

export function registerFileHandlers(handle: Handle): void {
  handle('pick-attachment-files', async () => ({ success: true, data: rememberPicked(await pickFiles({ multiple: true })) }))

  handle('upload-picked-attachment', async (_event, taskId: unknown, token: unknown) => {
    if (!isId(taskId)) return { success: false, error: 'Invalid task' }
    const held = typeof token === 'string' ? picked.get(token) : undefined
    if (typeof token === 'string') picked.delete(token)
    if (!held || Date.now() - held.at > TOKEN_TTL_MS) return { success: false, error: 'The picked file is no longer available. Pick it again.' }
    const sent = await uploadFile(taskId, held.file)
    if (sent.kind === 'failed') return { success: false, error: sent.error }
    return { success: true, data: { attachments: sent.attachments } }
  })

  // The attach dialog of a comment: the files picked, uploaded one after the other in this call.
  handle('pick-and-upload-attachment', async (_event, taskId: unknown) => {
    if (!isId(taskId)) return { success: false, error: 'Invalid task' }
    const files = await pickFiles({ multiple: true })
    if (files.length === 0) return { success: true, data: { count: 0, attachments: [] } }
    let count = 0
    let lastError = ''
    const attachments: unknown[] = []
    for (const file of files) {
      const sent = await uploadFile(taskId, file)
      if (sent.kind === 'failed') lastError = sent.error
      else {
        attachments.push(...sent.attachments)
        count++
      }
    }
    if (count === 0) return { success: false, error: lastError || 'Upload failed' }
    return { success: true, data: { count, attachments, queued: [], ...(lastError ? { error: lastError } : {}) } }
  })

  // "Save": the browser's own download, into its downloads folder.
  handle('save-task-attachment', async (_event, taskId: unknown, attachmentId: unknown, fileName: unknown) => {
    if (!isId(taskId) || !isId(attachmentId)) return { success: false, error: 'Invalid attachment' }
    const result = await downloadTaskAttachment(taskId, attachmentId)
    if (!result.success) return result
    download(result.data, sanitizeAttachmentFileName(fileName, `attachment-${attachmentId}`))
    return { success: true, data: { saved: true } }
  })

  // "Open": a picture, a PDF or plain text opens in a new tab; anything else is downloaded, so
  // nothing from the server is ever shown as a page of this origin.
  handle('open-task-attachment', async (_event, taskId: unknown, attachmentId: unknown, fileName: unknown) => {
    if (!isId(taskId) || !isId(attachmentId)) return { success: false, error: 'Invalid attachment' }
    const result = await downloadTaskAttachment(taskId, attachmentId)
    if (!result.success) return result
    const name = sanitizeAttachmentFileName(fileName, `attachment-${attachmentId}`)
    const type = isRiskyAttachment(name, osPlatform) ? undefined : SHOWN_IN_A_TAB[extensionOf(name)]
    // A blocked pop-up answers null: the file is downloaded instead.
    if (!type || !window.open(blobUrl(result.data, type), '_blank')) download(result.data, name)
    return { success: true, data: undefined }
  })

  // A recap copied with both a plain text and an HTML version (cross-app semantics 21.8).
  handle('clipboard:write-rich', async (_event, text: unknown, html: unknown) => {
    if (typeof text !== 'string' || text.length > 1_000_000) throw new Error('Invalid text')
    if (typeof html === 'string' && html.length <= 2_000_000 && typeof ClipboardItem === 'function') {
      try {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        })])
        return true
      } catch {
        // A browser that takes no HTML on the clipboard: the plain text below.
      }
    }
    await navigator.clipboard.writeText(text)
    return true
  })

  handle('clipboard:write-image', async (_event, bytes: unknown) => {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 100 * 1024 * 1024) {
      return { success: false, error: 'Invalid image' }
    }
    const png = await asPng(bytes)
    if (!png || typeof ClipboardItem !== 'function') return { success: false, error: 'This image cannot be copied' }
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      return { success: true, data: undefined }
    } catch {
      return { success: false, error: 'The browser did not allow copying the image' }
    }
  })

  handle('print-html', (_event, html: unknown): PrintResult | Promise<PrintResult> =>
    typeof html === 'string' ? printHtml(html) : { success: false, error: 'Print failed' })

  // Importing a calendar file into Events, once (contract 20.10): nothing stays linked to the file.
  handle('calendar:import-file', async () => {
    const [file] = await pickFiles({ multiple: false, accept: '.ics,.ical,.icalendar,.ifb,text/calendar' })
    if (!file) return { success: true, data: null }
    if (file.size > 5 * 1024 * 1024) return { success: false, error: 'The file is too large to import (more than 5 MB).' }
    try {
      const text = (await file.text()).replace(/^﻿/, '')
      return importPreview(text, file.name, toLocalDate(new Date()))
    } catch {
      return { success: false, error: 'The file could not be opened.' }
    }
  })

  // The completion sound: the built-in one (a sound of your own is a file on a computer).
  handle('sound:get-info', () => ({ path: '', fileName: 'done.mp3', isDefault: true }))
  handle('sound:read', async () => {
    try {
      const response = await fetch(doneSoundUrl)
      if (!response.ok) return { success: false, error: 'Failed to read sound file' }
      return { success: true, data: new Uint8Array(await response.arrayBuffer()), mimeType: 'audio/mpeg' }
    } catch {
      return { success: false, error: 'Failed to read sound file' }
    }
  })
}
