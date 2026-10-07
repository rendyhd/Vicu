import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  BLOCKED_ATTACHMENT_EXTENSIONS,
  MAX_BINARY_DOWNLOAD_BYTES,
  describeDownloadLimit,
  isRiskyAttachment,
  parseContentLength,
  sanitizeAttachmentFileName,
} from '../attachment-safety'
import {
  attachmentTempDirFor,
  cleanAttachmentTempDir,
  ensureAttachmentTempDir,
} from '../attachment-temp'

describe('isRiskyAttachment', () => {
  it.each([
    'setup.exe', 'run.bat', 'run.cmd', 'tool.com', 'app.msi', 'app.msix', 'x.ps1', 'x.psm1',
    'x.vbs', 'x.vbe', 'x.js', 'x.jse', 'x.wsf', 'x.wsh', 'x.hta', 'x.scr', 'x.pif',
    'shortcut.lnk', 'link.url', 'patch.reg', 'panel.cpl', 'x.jar', 'Thing.app', 'x.command',
    'x.sh', 'x.AppImage', 'x.deb', 'x.rpm', 'x.dmg', 'x.pkg', 'budget.xlsm', 'x.docm', 'disk.iso',
    'x.chm', 'conn.rdp',
  ])('blocks %s', (name) => {
    expect(isRiskyAttachment(name)).toBe(true)
  })

  it.each(['photo.png', 'photo.JPG', 'notes.txt', 'report.pdf', 'sheet.xlsx', 'doc.docx', 'archive.zip', 'song.mp3', 'clip.mp4'])(
    'allows %s',
    (name) => {
      expect(isRiskyAttachment(name)).toBe(false)
    }
  )

  it('looks at the last extension only', () => {
    expect(isRiskyAttachment('invoice.pdf.exe')).toBe(true)
    expect(isRiskyAttachment('setup.exe.txt')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isRiskyAttachment('SETUP.EXE')).toBe(true)
    expect(isRiskyAttachment('Run.Bat')).toBe(true)
  })

  it('sees through tricks that hide the extension', () => {
    expect(isRiskyAttachment('evil.exe.')).toBe(true)
    expect(isRiskyAttachment('evil.exe   ')).toBe(true)
    expect(isRiskyAttachment('evil.exe\u202e')).toBe(true)
    expect(isRiskyAttachment('evil.\u200bexe')).toBe(true)
    expect(isRiskyAttachment('..\\..\\evil.exe')).toBe(true)
    expect(isRiskyAttachment('folder/evil.cmd')).toBe(true)
  })

  it('treats names without a usable extension as risky', () => {
    expect(isRiskyAttachment('README')).toBe(true)
    expect(isRiskyAttachment('.exe')).toBe(true)
    expect(isRiskyAttachment('')).toBe(true)
    expect(isRiskyAttachment(undefined)).toBe(true)
    expect(isRiskyAttachment(42)).toBe(true)
  })

  it('keeps the extension list lowercase and without dots', () => {
    for (const ext of BLOCKED_ATTACHMENT_EXTENSIONS) {
      expect(ext).toBe(ext.toLowerCase())
      expect(ext.startsWith('.')).toBe(false)
    }
    for (const required of ['exe', 'bat', 'cmd', 'com', 'msi', 'msix', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf',
      'wsh', 'hta', 'scr', 'pif', 'lnk', 'url', 'reg', 'cpl', 'jar', 'app', 'command', 'sh', 'appimage', 'deb', 'rpm',
      'dmg', 'pkg']) {
      expect(BLOCKED_ATTACHMENT_EXTENSIONS.has(required)).toBe(true)
    }
  })
})

describe('sanitizeAttachmentFileName', () => {
  it('keeps ordinary names', () => {
    expect(sanitizeAttachmentFileName('report 2026 (final).pdf')).toBe('report 2026 (final).pdf')
    expect(sanitizeAttachmentFileName('Fotó éé.png')).toBe('Fotó éé.png')
  })

  it('drops directory components for both separators', () => {
    expect(sanitizeAttachmentFileName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeAttachmentFileName('..\\..\\Windows\\win.ini')).toBe('win.ini')
    expect(sanitizeAttachmentFileName('C:\\Users\\me\\file.txt')).toBe('file.txt')
    expect(sanitizeAttachmentFileName('/abs/path/file.txt')).toBe('file.txt')
  })

  it('never returns a path separator', () => {
    for (const input of ['a/b', 'a\\b', '/', '\\', '../x', 'x/..', 'a/b/c.txt', '....//....//x']) {
      expect(sanitizeAttachmentFileName(input)).not.toMatch(/[\\/]/)
    }
  })

  it('replaces characters Windows rejects', () => {
    expect(sanitizeAttachmentFileName('a<b>c:d"e|f?g*h.txt')).toBe('a_b_c_d_e_f_g_h.txt')
  })

  it('removes control, bidi and zero-width characters', () => {
    expect(sanitizeAttachmentFileName('ab\u0000c\u0007d.txt')).toBe('abcd.txt')
    expect(sanitizeAttachmentFileName('photo\u202egnp.exe')).toBe('photognp.exe')
    expect(sanitizeAttachmentFileName('\ufeffname.txt')).toBe('name.txt')
  })

  it('strips trailing dots and spaces', () => {
    expect(sanitizeAttachmentFileName('name.txt. . ')).toBe('name.txt')
    expect(sanitizeAttachmentFileName('  lead.txt')).toBe('lead.txt')
  })

  it('falls back when nothing usable is left', () => {
    expect(sanitizeAttachmentFileName('')).toBe('attachment')
    expect(sanitizeAttachmentFileName('..')).toBe('attachment')
    expect(sanitizeAttachmentFileName('.')).toBe('attachment')
    expect(sanitizeAttachmentFileName('   ')).toBe('attachment')
    expect(sanitizeAttachmentFileName(undefined)).toBe('attachment')
    expect(sanitizeAttachmentFileName(null, 'file-7')).toBe('file-7')
    expect(sanitizeAttachmentFileName({}, 'file-7')).toBe('file-7')
  })

  it('prefixes reserved Windows device names', () => {
    expect(sanitizeAttachmentFileName('CON')).toBe('_CON')
    expect(sanitizeAttachmentFileName('nul.txt')).toBe('_nul.txt')
    expect(sanitizeAttachmentFileName('COM1.log')).toBe('_COM1.log')
    expect(sanitizeAttachmentFileName('console.txt')).toBe('console.txt')
  })

  it('bounds the length and keeps the extension', () => {
    const long = `${'a'.repeat(300)}.pdf`
    const out = sanitizeAttachmentFileName(long)
    expect(out.length).toBeLessThanOrEqual(120)
    expect(out.endsWith('.pdf')).toBe(true)
  })
})

describe('download size cap', () => {
  it('is 100 MB', () => {
    expect(MAX_BINARY_DOWNLOAD_BYTES).toBe(100 * 1024 * 1024)
  })

  it('parses Content-Length', () => {
    expect(parseContentLength('1234')).toBe(1234)
    expect(parseContentLength([' 99 '])).toBe(99)
    expect(parseContentLength(undefined)).toBeNull()
    expect(parseContentLength('')).toBeNull()
    expect(parseContentLength('abc')).toBeNull()
    expect(parseContentLength('-5')).toBeNull()
    expect(parseContentLength('12abc')).toBeNull()
    expect(parseContentLength('99999999999999999999999')).toBeNull()
  })

  it('describes the limit in the error message', () => {
    expect(describeDownloadLimit()).toBe('File is too large to download (limit 100 MB)')
    expect(describeDownloadLimit(5 * 1024 * 1024)).toContain('5 MB')
  })
})

describe('attachment temp folder', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vicu-att-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('lives in a dedicated vicu-attachments folder', () => {
    expect(attachmentTempDirFor(root)).toBe(join(root, 'vicu-attachments'))
    const dir = ensureAttachmentTempDir(root)
    expect(existsSync(dir)).toBe(true)
  })

  it('removes the folder and its contents, leaving siblings alone', () => {
    const dir = ensureAttachmentTempDir(root)
    mkdirSync(join(dir, 'nested'))
    writeFileSync(join(dir, '1-a.pdf'), 'x')
    writeFileSync(join(dir, 'nested', '2-b.txt'), 'y')
    writeFileSync(join(root, 'vicu-print.html'), 'keep')

    expect(cleanAttachmentTempDir(root)).toBe(true)
    expect(existsSync(dir)).toBe(false)
    expect(readdirSync(root)).toEqual(['vicu-print.html'])
  })

  it('is a no-op when the folder does not exist', () => {
    expect(cleanAttachmentTempDir(root)).toBe(true)
  })
})
