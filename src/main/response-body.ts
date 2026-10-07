/**
 * Decode a response body that arrived as several chunks.
 *
 * Chunk boundaries can fall inside a multibyte UTF-8 character, so decoding
 * each chunk on its own turns that character into U+FFFD. Join the raw bytes
 * first and decode once (D-API-1, D-UPD-1).
 */
export function decodeUtf8Chunks(chunks: readonly Uint8Array[]): string {
  return Buffer.concat(chunks).toString('utf8')
}
