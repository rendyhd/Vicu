/** Bytes as base64, without Node's Buffer, so it runs in Node, Electron and a browser alike. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  // In pieces: one call with every byte as an argument overflows the stack on a large file.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}
