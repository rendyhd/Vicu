import { describe, expect, it } from 'vitest'
import { compareVersions, isNewerVersion } from '../update-version'

describe('compareVersions', () => {
  it.each<[string, string, number]>([
    ['1.8.1', '1.8.1', 0],
    ['v1.8.1', '1.8.1', 0],
    ['1.8.1', '1.8.2', -1],
    ['1.8.2', '1.8.1', 1],
    ['1.9.0', '1.8.9', 1],
    ['2.0.0', '1.99.99', 1],
    // numeric parts compare as numbers, not text
    ['1.10.0', '1.9.0', 1],
    ['1.9.0', '1.10.0', -1],
    // a missing part is zero
    ['1.9', '1.9.0', 0],
    ['1', '1.0.0', 0],
    ['1.9', '1.9.1', -1],
    // build metadata never counts
    ['1.9.0+build.5', '1.9.0', 0],
    ['1.9.0+a', '1.9.0+b', 0],
  ])('%s vs %s is %d', (a, b, expected) => {
    expect(Math.sign(compareVersions(a, b))).toBe(expected)
  })

  describe('prereleases', () => {
    it.each<[string, string, number]>([
      ['1.9.0-beta.1', '1.9.0', -1],
      ['1.9.0', '1.9.0-beta.1', 1],
      ['1.9.0-beta.1', '1.9.0-beta.1', 0],
      ['1.9.0-alpha', '1.9.0-beta', -1],
      ['1.9.0-beta.2', '1.9.0-beta.11', -1],
      ['1.9.0-beta.11', '1.9.0-beta.2', 1],
      ['1.9.0-alpha', '1.9.0-alpha.1', -1],
      ['1.9.0-alpha.1', '1.9.0-alpha.beta', -1],
      ['1.9.0-alpha.beta', '1.9.0-beta', -1],
      ['1.9.0-beta', '1.9.0-beta.2', -1],
      ['1.9.0-rc.1', '1.9.0-beta.9', 1],
      // the core version decides before the prerelease does
      ['1.9.0-beta.1', '1.8.9', 1],
      ['1.8.9', '1.9.0-beta.1', -1],
      ['1.9.0-0', '1.9.0-1', -1],
    ])('%s vs %s is %d', (a, b, expected) => {
      expect(Math.sign(compareVersions(a, b))).toBe(expected)
    })

    it('compares long numeric identifiers without losing precision', () => {
      expect(compareVersions('1.0.0-9007199254740993', '1.0.0-9007199254740992')).toBeGreaterThan(0)
    })
  })

  describe('never NaN', () => {
    it.each(['', 'x', 'v', '1.x.3', 'latest', '1..2', '-', '1.2.3-', '..', 'v1.beta.2'])('on %j', (garbage) => {
      expect(Number.isNaN(compareVersions(garbage, '1.0.0'))).toBe(false)
      expect(Number.isNaN(compareVersions('1.0.0', garbage))).toBe(false)
      expect(Number.isNaN(compareVersions(garbage, garbage))).toBe(false)
    })

    it('treats an unreadable version as 0.0.0', () => {
      expect(compareVersions('nonsense', '0.0.0')).toBe(0)
      expect(compareVersions('nonsense', '0.0.1')).toBeLessThan(0)
    })
  })
})

describe('isNewerVersion', () => {
  it('is true only when the latest is ahead of the current', () => {
    expect(isNewerVersion('1.8.1', '1.9.0')).toBe(true)
    expect(isNewerVersion('1.9.0', '1.9.0')).toBe(false)
    expect(isNewerVersion('1.9.1', '1.9.0')).toBe(false)
  })

  it('offers the release over the prerelease it follows', () => {
    expect(isNewerVersion('1.9.0-beta.1', '1.9.0')).toBe(true)
    expect(isNewerVersion('1.9.0-beta.1', '1.9.0-beta.2')).toBe(true)
    expect(isNewerVersion('1.9.0', '1.9.0-beta.2')).toBe(false)
  })

  it('does not offer an update for a tag that cannot be read', () => {
    expect(isNewerVersion('1.8.1', 'latest')).toBe(false)
    expect(isNewerVersion('1.8.1', '')).toBe(false)
  })
})
