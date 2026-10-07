import { describe, expect, it } from 'vitest'
import { decodeUtf8Chunks } from '../response-body'

describe('decodeUtf8Chunks', () => {
  it('decodes a body split inside a multibyte character', () => {
    const body = Buffer.from(JSON.stringify({ title: 'Café 日本語 🚀' }), 'utf8')
    // Split in the middle of the two-byte "é", the three-byte kanji and the four-byte emoji.
    const e = body.indexOf(0xc3)
    const kanji = body.indexOf(0xe6)
    const emoji = body.indexOf(0xf0)
    const chunks = [
      body.subarray(0, e + 1),
      body.subarray(e + 1, kanji + 1),
      body.subarray(kanji + 1, emoji + 2),
      body.subarray(emoji + 2),
    ]

    const decoded = decodeUtf8Chunks(chunks)

    expect(decoded).not.toContain('�')
    expect(JSON.parse(decoded)).toEqual({ title: 'Café 日本語 🚀' })
  })

  it('shows why per-chunk decoding is wrong', () => {
    const body = Buffer.from('é', 'utf8')
    const perChunk = body.subarray(0, 1).toString() + body.subarray(1).toString()
    expect(perChunk).toContain('�')
    expect(decodeUtf8Chunks([body.subarray(0, 1), body.subarray(1)])).toBe('é')
  })

  it('accepts Uint8Array chunks and an empty body', () => {
    expect(decodeUtf8Chunks([])).toBe('')
    expect(decodeUtf8Chunks([new Uint8Array([0x68, 0x69])])).toBe('hi')
  })
})
