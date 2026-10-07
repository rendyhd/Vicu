/**
 * Building a multipart/form-data upload body safely. Pure, so it can be tested.
 *
 * The file name used to be written into the Content-Disposition header as it was, so a name with
 * a quote ended the quoted string early and a name with CR/LF could add headers or a second part
 * (D-API-3).
 */

const FALLBACK_FILE_NAME = 'file'
const FALLBACK_MIME_TYPE = 'application/octet-stream'
const MIME_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/

// RFC 5987 attr-char: everything encodeURIComponent leaves alone except ' ( ) *
function percentEncodeExtended(value: string): string {
  const wellFormed = (value as string & { toWellFormed?: () => string }).toWellFormed?.() ?? value
  return encodeURIComponent(wellFormed).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
}

/**
 * `form-data; name="files"; filename="..."`. The quoted filename is an ASCII fallback: quotes and
 * backslashes are backslash-escaped, and control and non-ASCII characters (CR and LF included) become
 * `_`. When the name had any of those, `filename*=UTF-8''...` carries the exact name, which
 * servers that understand RFC 5987 (Go's mime package does) prefer.
 */
export function contentDispositionForFile(fieldName: string, fileName: string): string {
  const name = fileName === '' ? FALLBACK_FILE_NAME : fileName
  let fallback = ''
  let exact = true
  for (const ch of name) {
    if (ch === '"' || ch === '\\') {
      fallback += '\\' + ch
    } else if (ch >= ' ' && ch <= '~') {
      fallback += ch
    } else {
      fallback += '_'
      exact = false
    }
  }
  const base = `form-data; name="${fieldName}"; filename="${fallback}"`
  return exact ? base : `${base}; filename*=UTF-8''${percentEncodeExtended(name)}`
}

/** A type that is safe to write into a Content-Type header, or the generic binary type. */
export function sanitizeMimeType(mimeType: unknown): string {
  return typeof mimeType === 'string' && MIME_TYPE.test(mimeType) ? mimeType : FALLBACK_MIME_TYPE
}

export interface MultipartFile {
  boundary: string
  fieldName: string
  fileName: string
  mimeType: string
  file: Buffer
}

export function buildMultipartBody(input: MultipartFile): Buffer {
  const head = Buffer.from(
    `--${input.boundary}\r\n` +
      `Content-Disposition: ${contentDispositionForFile(input.fieldName, input.fileName)}\r\n` +
      `Content-Type: ${sanitizeMimeType(input.mimeType)}\r\n\r\n`,
  )
  const tail = Buffer.from(`\r\n--${input.boundary}--\r\n`)
  return Buffer.concat([head, input.file, tail])
}
