import { describe, expect, it } from 'vitest'
import { buildMultipartBody, contentDispositionForFile, sanitizeMimeType } from '../multipart'

/** The part of an RFC 2616 quoted-string a server unescapes: \x becomes x. */
function unquote(quoted: string): string {
  return quoted.slice(1, -1).replace(/\\(.)/g, '$1')
}

function filenameParam(header: string): string {
  const match = /; filename="((?:[^"\\]|\\.)*)"/.exec(header)
  expect(match).not.toBeNull()
  return unquote(`"${match![1]}"`)
}

describe('contentDispositionForFile', () => {
  it('writes a plain name as it is', () => {
    expect(contentDispositionForFile('files', 'report.pdf')).toBe('form-data; name="files"; filename="report.pdf"')
  })

  it('escapes quotes and backslashes so the name cannot end the quoted string early', () => {
    const header = contentDispositionForFile('files', 'a"b\\c.txt')
    expect(header).toBe('form-data; name="files"; filename="a\\"b\\\\c.txt"')
    expect(filenameParam(header)).toBe('a"b\\c.txt')
  })

  it('cannot be used to inject a header or a second part', () => {
    const header = contentDispositionForFile('files', 'x.txt"\r\nContent-Type: text/html\r\n\r\n<script>')
    expect(header).not.toMatch(/[\r\n]/)
    // Only one filename parameter outside the escaped string.
    expect(header.match(/; filename=/g)).toHaveLength(1)
  })

  it('replaces CR and LF in the plain name and carries the exact name in filename*', () => {
    const header = contentDispositionForFile('files', 'two\r\nlines.txt')
    expect(header).not.toMatch(/[\r\n]/)
    expect(header).toContain('filename="two__lines.txt"')
    expect(header).toContain("filename*=UTF-8''two%0D%0Alines.txt")
  })

  it('adds filename* for non-ASCII names, with an ASCII fallback', () => {
    const header = contentDispositionForFile('files', 'Café 日本.txt')
    expect(header).toContain('filename="Caf_ __.txt"')
    expect(header).toContain("filename*=UTF-8''Caf%C3%A9%20%E6%97%A5%E6%9C%AC.txt")
    const encoded = /filename\*=UTF-8''([^;]+)/.exec(header)![1]
    expect(decodeURIComponent(encoded)).toBe('Café 日本.txt')
  })

  it('percent-encodes the characters RFC 5987 does not allow unencoded', () => {
    const header = contentDispositionForFile('files', "it's (1)*é.txt")
    const encoded = /filename\*=UTF-8''([^;]+)/.exec(header)![1]
    expect(encoded).not.toMatch(/['()*]/)
    expect(decodeURIComponent(encoded)).toBe("it's (1)*é.txt")
  })

  it('survives a lone surrogate', () => {
    expect(() => contentDispositionForFile('files', 'bad\ud800name.txt')).not.toThrow()
  })

  it('falls back to a name for an empty one', () => {
    expect(contentDispositionForFile('files', '')).toBe('form-data; name="files"; filename="file"')
  })
})

describe('sanitizeMimeType', () => {
  it('keeps a normal type', () => {
    expect(sanitizeMimeType('image/png')).toBe('image/png')
    expect(sanitizeMimeType('application/vnd.ms-excel')).toBe('application/vnd.ms-excel')
    expect(sanitizeMimeType('image/svg+xml')).toBe('image/svg+xml')
  })

  it('replaces anything that could break the header', () => {
    expect(sanitizeMimeType('text/plain\r\nX-Evil: 1')).toBe('application/octet-stream')
    expect(sanitizeMimeType('')).toBe('application/octet-stream')
    expect(sanitizeMimeType(undefined)).toBe('application/octet-stream')
    expect(sanitizeMimeType('no-slash')).toBe('application/octet-stream')
  })
})

describe('buildMultipartBody', () => {
  it('wraps the file between the boundary lines', () => {
    const file = Buffer.from([0, 1, 2, 255, 13, 10, 45, 45])
    const body = buildMultipartBody({ boundary: 'XYZ', fieldName: 'files', fileName: 'a.bin', mimeType: 'application/octet-stream', file })
    const head =
      '--XYZ\r\nContent-Disposition: form-data; name="files"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n'
    const tail = '\r\n--XYZ--\r\n'
    expect(body.subarray(0, head.length).toString()).toBe(head)
    expect(body.subarray(head.length, head.length + file.length).equals(file)).toBe(true)
    expect(body.subarray(head.length + file.length).toString()).toBe(tail)
    expect(body.length).toBe(head.length + file.length + tail.length)
  })

  it('uses the sanitized type and the escaped name', () => {
    const body = buildMultipartBody({
      boundary: 'B',
      fieldName: 'files',
      fileName: 'a"b.txt',
      mimeType: 'text/plain\r\nEvil: 1',
      file: Buffer.from('x'),
    })
    const text = body.toString()
    expect(text).toContain('filename="a\\"b.txt"')
    expect(text).toContain('Content-Type: application/octet-stream')
    expect(text).not.toContain('Evil')
  })
})
