import { describe, expect, it } from 'vitest'
import { secretNoticeTitle } from '../SecretStorageNotice'

describe('secretNoticeTitle', () => {
  it('words the notice for the key and for the sign-in token', () => {
    expect(secretNoticeTitle('key', 'obfuscated')).toBe('The key is obfuscated, not encrypted')
    expect(secretNoticeTitle('key', 'plaintext')).toBe('The key is not encrypted')
    expect(secretNoticeTitle('token', 'obfuscated')).toBe('Sign-in token is obfuscated, not encrypted')
    expect(secretNoticeTitle('token', 'plaintext')).toBe('Sign-in token is not encrypted')
  })
})
