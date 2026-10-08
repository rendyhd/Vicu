import { describe, expect, it } from 'vitest'
import { isDarkTheme } from '../theme'

describe('isDarkTheme', () => {
  it('follows the window colour scheme only for the system theme', () => {
    expect(isDarkTheme('system', true)).toBe(true)
    expect(isDarkTheme('system', false)).toBe(false)
  })

  it('takes a chosen theme whatever the window colour scheme reports', () => {
    expect(isDarkTheme('dark', false)).toBe(true)
    expect(isDarkTheme('light', true)).toBe(false)
  })

  it('falls back to the window colour scheme for a missing or unknown theme', () => {
    expect(isDarkTheme(undefined, true)).toBe(true)
    expect(isDarkTheme(null, false)).toBe(false)
    expect(isDarkTheme('sepia', true)).toBe(true)
  })
})
