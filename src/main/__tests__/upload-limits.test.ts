import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  describeSize,
  parseMaxFileSize,
  uploadSizeError,
  uploadTimeoutMs,
} from '../upload-limits'

describe('parseMaxFileSize (the /info max_file_size string)', () => {
  it('reads the server default and its spellings', () => {
    expect(parseMaxFileSize('20MB')).toBe(20_000_000)
    expect(parseMaxFileSize('20 MB')).toBe(20_000_000)
    expect(parseMaxFileSize('20mb')).toBe(20_000_000)
    expect(parseMaxFileSize('1GB')).toBe(1_000_000_000)
    expect(parseMaxFileSize('512KB')).toBe(512_000)
    expect(parseMaxFileSize('1.5MB')).toBe(1_500_000)
  })

  it('reads binary units as powers of 1024', () => {
    expect(parseMaxFileSize('20MiB')).toBe(20 * 1024 * 1024)
    expect(parseMaxFileSize('1GiB')).toBe(1024 ** 3)
  })

  it('reads a bare number as bytes', () => {
    expect(parseMaxFileSize('1048576')).toBe(1_048_576)
    expect(parseMaxFileSize('100B')).toBe(100)
    expect(parseMaxFileSize(5_000_000)).toBe(5_000_000)
  })

  it('returns null for anything else, so the caller uses the default', () => {
    expect(parseMaxFileSize(undefined)).toBeNull()
    expect(parseMaxFileSize(null)).toBeNull()
    expect(parseMaxFileSize('')).toBeNull()
    expect(parseMaxFileSize('lots')).toBeNull()
    expect(parseMaxFileSize('20 parsecs')).toBeNull()
    expect(parseMaxFileSize('0MB')).toBeNull()
    expect(parseMaxFileSize('-5MB')).toBeNull()
    expect(parseMaxFileSize(Number.NaN)).toBeNull()
    expect(parseMaxFileSize({})).toBeNull()
  })
})

describe('DEFAULT_MAX_UPLOAD_BYTES', () => {
  it('is 20 MB, the server default', () => {
    expect(DEFAULT_MAX_UPLOAD_BYTES).toBe(20_000_000)
  })
})

describe('describeSize', () => {
  it('uses MB with at most one decimal', () => {
    expect(describeSize(20_000_000)).toBe('20 MB')
    expect(describeSize(12_400_000)).toBe('12.4 MB')
    expect(describeSize(1_500_000_000)).toBe('1500 MB')
  })

  it('uses KB and bytes for small sizes', () => {
    expect(describeSize(512_000)).toBe('512 KB')
    expect(describeSize(900)).toBe('900 bytes')
  })
})

describe('uploadSizeError', () => {
  it('is null when the file fits, including exactly at the limit', () => {
    expect(uploadSizeError(1, 20_000_000)).toBeNull()
    expect(uploadSizeError(20_000_000, 20_000_000)).toBeNull()
  })

  it('names both sizes when it does not', () => {
    const error = uploadSizeError(25_300_000, 20_000_000)
    expect(error).toContain('too large')
    expect(error).toContain('25.3 MB')
    expect(error).toContain('20 MB')
  })
})

describe('uploadTimeoutMs', () => {
  it('is a minute for a small file and grows with the size', () => {
    expect(uploadTimeoutMs(0)).toBe(60_000)
    expect(uploadTimeoutMs(100_000)).toBe(60_000 + 2_000)
    expect(uploadTimeoutMs(20_000_000)).toBeGreaterThan(300_000)
  })

  it('stops growing at a cap', () => {
    expect(uploadTimeoutMs(10_000_000_000)).toBeLessThanOrEqual(30 * 60_000)
  })
})
