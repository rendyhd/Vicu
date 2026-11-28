/** Bytes as base64, without Node's Buffer, so it runs in Node, Electron and a browser alike. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  // In pieces: one call with every byte as an argument overflows the stack on a large file.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** Bytes as base64url without padding (what Node's `toString('base64url')` writes). */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * The bytes of a base64 or base64url text, read as leniently as Node's Buffer does: padding is
 * optional, and a last character that cannot complete a byte is dropped instead of refused.
 */
export function base64ToBytes(text: string): Uint8Array {
  let clean = text.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')
  if (clean.length % 4 === 1) clean = clean.slice(0, -1)
  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** A text as its UTF-8 bytes. */
export function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** UTF-8 bytes as text, as Node's `toString('utf8')` reads them (a byte order mark is kept). */
export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
}
