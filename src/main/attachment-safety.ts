// Safety helpers for task attachments that come from the Vikunja server (D-IPC-2).
// Any collaborator on a shared project can upload a file, and the temp copy we
// write has no Mark-of-the-Web, so opening it would run executables and macro
// documents without the usual operating-system warnings. Pure functions only.

/** Cap on a single binary download from the server (attachments, previews). */
export const MAX_BINARY_DOWNLOAD_BYTES = 100 * 1024 * 1024

/**
 * Extensions that are never opened. They are revealed in the file manager
 * instead, so the user has to act on the file deliberately.
 */
export const BLOCKED_ATTACHMENT_EXTENSIONS: ReadonlySet<string> = new Set([
  // Windows executables, installers and packages
  'exe', 'com', 'scr', 'pif', 'msi', 'msp', 'mst', 'msix', 'msixbundle', 'appx', 'appxbundle',
  'application', 'gadget', 'cpl', 'dll', 'ocx', 'sys', 'drv', 'xll',
  // Windows scripts and script hosts
  'bat', 'cmd', 'btm', 'ps1', 'ps1xml', 'ps2', 'ps2xml', 'psc1', 'psc2', 'psd1', 'psm1',
  'vbs', 'vbe', 'vb', 'js', 'jse', 'wsf', 'wsh', 'wsc', 'ws', 'sct', 'hta', 'msc', 'reg', 'rgs',
  'inf', 'ins', 'isp', 'job', 'pyw', 'py', 'pyc', 'pyz',
  // Shortcuts and launchers
  'lnk', 'url', 'scf', 'rdp', 'jnlp', 'desktop', 'terminal', 'website', 'appref-ms',
  'settingcontent-ms', 'library-ms', 'searchconnector-ms', 'diagcab',
  // Compiled help (runs script)
  'chm', 'hlp',
  // Macro-enabled Office documents and Access databases
  'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppam', 'ppsm', 'sldm',
  'slk', 'iqy', 'mdb', 'mde', 'ade', 'adp',
  // Disk images that mount without Mark-of-the-Web
  'iso', 'img', 'vhd', 'vhdx',
  // Java
  'jar',
  // macOS
  'app', 'command', 'tool', 'workflow', 'action', 'scpt', 'scptd', 'applescript', 'osx',
  'dmg', 'pkg', 'mpkg',
  // Linux and Unix
  'sh', 'bash', 'zsh', 'csh', 'ksh', 'fish', 'run', 'bin', 'out', 'elf', 'appimage',
  'deb', 'rpm', 'apk',
])

// Characters with no business in a file name: ASCII control characters, bidi
// overrides used to disguise extensions (U+202E), zero-width and BOM characters.
// eslint-disable-next-line no-control-regex
const HIDDEN_OR_CONTROL = /[\u0000-\u001f\u007f​-‏‪-‮⁠-⁩﻿]/g
const WINDOWS_INVALID = /[<>:"|?*]/g
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
const MAX_NAME_LENGTH = 120

/**
 * Turn a server-provided file name into something safe to use as a file name:
 * no directory components, no characters Windows rejects or hides, no reserved
 * device names, bounded length. Falls back to `fallback` when nothing is left.
 */
export function sanitizeAttachmentFileName(name: unknown, fallback = 'attachment'): string {
  const raw = typeof name === 'string' ? name : ''
  // Keep only the last path segment, whichever separator was used.
  const lastSegment = raw.split(/[\\/]/).pop() ?? ''
  let cleaned = lastSegment
    .replace(HIDDEN_OR_CONTROL, '')
    .replace(WINDOWS_INVALID, '_')
    // Windows drops trailing dots and spaces, which would hide the real extension.
    .replace(/^\s+/, '')
    .replace(/[. ]+$/, '')

  if (cleaned === '') return fallback
  if (WINDOWS_RESERVED.test(cleaned)) cleaned = `_${cleaned}`

  if (cleaned.length > MAX_NAME_LENGTH) {
    const dot = cleaned.lastIndexOf('.')
    const ext = dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : ''
    cleaned = cleaned.slice(0, MAX_NAME_LENGTH - ext.length) + ext
  }
  return cleaned
}

/**
 * True when the attachment must not be opened directly: blocked extension, or
 * no extension at all (the system would have to guess how to run it).
 */
export function isRiskyAttachment(fileName: unknown): boolean {
  const name = sanitizeAttachmentFileName(fileName, '')
  if (name === '') return true
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return true
  const ext = name.slice(dot + 1).toLowerCase()
  return BLOCKED_ATTACHMENT_EXTENSIONS.has(ext)
}

/** Parse a Content-Length header value. Returns null when absent or invalid. */
export function parseContentLength(header: string | string[] | undefined): number | null {
  const value = Array.isArray(header) ? header[0] : header
  if (value === undefined || !/^\d+$/.test(value.trim())) return null
  const parsed = Number(value.trim())
  return Number.isSafeInteger(parsed) ? parsed : null
}

/** Message shown when a download is rejected for exceeding the size cap. */
export function describeDownloadLimit(maxBytes: number = MAX_BINARY_DOWNLOAD_BYTES): string {
  return `File is too large to download (limit ${Math.round(maxBytes / (1024 * 1024))} MB)`
}
