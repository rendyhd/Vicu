import { describe, it, expect } from 'vitest'
import {
  buildBackupTokenTitle,
  findLegacyOwnToken,
  generateInstallId,
  isOwnedByInstall,
  isValidInstallId,
  legacyBackupTokenTitle,
  selectSiblingTokenIds,
  type ListedToken,
} from '../auth/backup-token'

describe('install id', () => {
  it('is six lowercase hex characters', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateInstallId()
      expect(id).toHaveLength(6)
      expect(isValidInstallId(id)).toBe(true)
    }
  })

  it('differs between calls', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateInstallId()))
    expect(ids.size).toBeGreaterThan(1)
  })

  it('formats bytes with leading zeros', () => {
    expect(generateInstallId(() => Uint8Array.from([0x0a, 0x00, 0xff]))).toBe('0a00ff')
  })

  it('validation rejects blank, short, long, non-hex and uppercase values', () => {
    expect(isValidInstallId('')).toBe(false)
    expect(isValidInstallId('a1b2c')).toBe(false)
    expect(isValidInstallId('a1b2c3d')).toBe(false)
    expect(isValidInstallId('a1b2cg')).toBe(false)
    expect(isValidInstallId('A1B2C3')).toBe(false)
    expect(isValidInstallId(undefined)).toBe(false)
    expect(isValidInstallId(123456)).toBe(false)
  })
})

describe('token titles', () => {
  it('builds the device title followed by the bracketed install id', () => {
    expect(buildBackupTokenTitle('MY-LAPTOP', 'a1b2c3')).toBe('Vicu — MY-LAPTOP [a1b2c3]')
  })

  it('keeps the old format available for migration', () => {
    expect(legacyBackupTokenTitle('MY-LAPTOP')).toBe('Vicu — MY-LAPTOP')
  })

  it('a token is owned by an install only when it carries that install id', () => {
    const title = buildBackupTokenTitle('MY-LAPTOP', 'a1b2c3')
    expect(isOwnedByInstall(title, 'a1b2c3')).toBe(true)
    expect(isOwnedByInstall(title, 'ffffff')).toBe(false)
  })

  it('legacy titles are never owned', () => {
    expect(isOwnedByInstall('Vicu — MY-LAPTOP', 'a1b2c3')).toBe(false)
  })

  it('tokens from other apps are never owned, even with a matching suffix', () => {
    expect(isOwnedByInstall('Backup script [a1b2c3]', 'a1b2c3')).toBe(false)
  })

  it('an invalid install id owns nothing', () => {
    expect(isOwnedByInstall('Vicu — MY-LAPTOP []', '')).toBe(false)
    expect(isOwnedByInstall('Vicu — MY-LAPTOP [a1b2c]', 'a1b2c')).toBe(false)
  })

  it('ownership survives a host name change', () => {
    expect(isOwnedByInstall('Vicu — OLD-NAME [a1b2c3]', 'a1b2c3')).toBe(true)
  })
})

describe('selectSiblingTokenIds', () => {
  it('keeps the new token, other machines, legacy tokens and manual tokens', () => {
    const tokens: ListedToken[] = [
      { id: 10, title: 'Vicu — MY-LAPTOP [a1b2c3]' }, // the token just created
      { id: 11, title: 'Vicu — MY-LAPTOP [a1b2c3]' }, // this install, stale
      { id: 12, title: 'Vicu — MY-LAPTOP [ffffff]' }, // another machine, same host name
      { id: 13, title: 'Vicu — MY-LAPTOP' }, // legacy title, owner unknown
      { id: 14, title: 'My own token' }, // user created
      { id: 15, title: 'Vicu — OLD-NAME [a1b2c3]' }, // this install, before a rename
      { id: 16, title: 'Vicu — Pixel 8 [ffffff]' }, // a phone
    ]
    expect(selectSiblingTokenIds(tokens, 'a1b2c3', 10)).toEqual([11, 15])
  })

  it('returns nothing for an invalid install id', () => {
    const tokens: ListedToken[] = [{ id: 1, title: 'Vicu — X []' }]
    expect(selectSiblingTokenIds(tokens, '', 99)).toEqual([])
  })
})

describe('findLegacyOwnToken', () => {
  const expiry = 1_800_000_000 // unix seconds stored locally at creation
  const iso = (unix: number): string => new Date(unix * 1000).toISOString()

  it('matches the token with our legacy title and exactly our expiry', () => {
    const tokens: ListedToken[] = [
      { id: 1, title: 'Vicu — MY-LAPTOP', expires_at: iso(expiry + 86_400) }, // same host name, created a day later
      { id: 2, title: 'Vicu — MY-LAPTOP', expires_at: iso(expiry) },
      { id: 3, title: 'Vicu — OTHER', expires_at: iso(expiry) },
    ]
    expect(findLegacyOwnToken(tokens, 'MY-LAPTOP', expiry)?.id).toBe(2)
  })

  it('tolerates one second of rounding on the server', () => {
    const tokens: ListedToken[] = [{ id: 2, title: 'Vicu — MY-LAPTOP', expires_at: iso(expiry + 1) }]
    expect(findLegacyOwnToken(tokens, 'MY-LAPTOP', expiry)?.id).toBe(2)
    const far: ListedToken[] = [{ id: 2, title: 'Vicu — MY-LAPTOP', expires_at: iso(expiry + 5) }]
    expect(findLegacyOwnToken(far, 'MY-LAPTOP', expiry)).toBeNull()
  })

  it('accepts timestamps with an offset and fractional seconds', () => {
    const tokens: ListedToken[] = [{ id: 2, title: 'Vicu — MY-LAPTOP', expires_at: '2027-01-15T10:00:00.000+02:00' }]
    const unix = Math.floor(Date.parse('2027-01-15T08:00:00Z') / 1000)
    expect(findLegacyOwnToken(tokens, 'MY-LAPTOP', unix)?.id).toBe(2)
  })

  it('never matches tokens that already have an install id', () => {
    const tokens: ListedToken[] = [{ id: 2, title: 'Vicu — MY-LAPTOP [a1b2c3]', expires_at: iso(expiry) }]
    expect(findLegacyOwnToken(tokens, 'MY-LAPTOP', expiry)).toBeNull()
  })

  it('returns null when ambiguous, unknown or unparseable', () => {
    const dup: ListedToken[] = [
      { id: 1, title: 'Vicu — MY-LAPTOP', expires_at: iso(expiry) },
      { id: 2, title: 'Vicu — MY-LAPTOP', expires_at: iso(expiry) },
    ]
    expect(findLegacyOwnToken(dup, 'MY-LAPTOP', expiry)).toBeNull()
    expect(findLegacyOwnToken(dup, 'MY-LAPTOP', null)).toBeNull()
    expect(findLegacyOwnToken([{ id: 3, title: 'Vicu — MY-LAPTOP' }], 'MY-LAPTOP', expiry)).toBeNull()
    expect(findLegacyOwnToken([{ id: 3, title: 'Vicu — MY-LAPTOP', expires_at: 'soon' }], 'MY-LAPTOP', expiry)).toBeNull()
  })
})
