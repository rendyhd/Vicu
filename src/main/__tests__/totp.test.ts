import { describe, expect, it } from 'vitest'
import {
  INVALID_TOTP_ERROR_CODE,
  USED_TOTP_ERROR_CODE,
  isTotpChallenge,
  isTotpCodeComplete,
  parseVikunjaProblem,
  sanitizeTotpCode,
} from '../auth/totp'

describe('Vikunja TOTP challenges', () => {
  it('recognizes missing, invalid, and reused passcode responses', () => {
    expect(isTotpChallenge(412, INVALID_TOTP_ERROR_CODE)).toBe(true)
    expect(isTotpChallenge(412, USED_TOTP_ERROR_CODE)).toBe(true)
    expect(isTotpChallenge(403, INVALID_TOTP_ERROR_CODE)).toBe(false)
    expect(isTotpChallenge(412, 1011)).toBe(false)
  })

  it('parses RFC problem details returned by Vikunja', () => {
    expect(parseVikunjaProblem(
      '{"detail":"Invalid totp passcode.","code":1017}',
      412
    )).toEqual({
      errorCode: INVALID_TOTP_ERROR_CODE,
      message: 'Invalid totp passcode.',
    })
  })

  it('sanitizes pasted codes and requires exactly six digits', () => {
    expect(sanitizeTotpCode('12a34 5678')).toBe('123456')
    expect(isTotpCodeComplete('012345')).toBe(true)
    expect(isTotpCodeComplete('12345')).toBe(false)
    expect(isTotpCodeComplete('12345a')).toBe(false)
  })
})
