import { describe, expect, it } from 'vitest'
import { loadTokens, tailwindTheme } from '../../../../scripts/gen-tokens.mjs'
import { cn, FONT_SIZE_ROLES, RADIUS_ROLES } from '../cn'

describe('cn with the role classes', () => {
  it('keeps a type role next to a colour role', () => {
    expect(cn('text-caption', 'text-status-overdue')).toBe('text-caption text-status-overdue')
    expect(cn('text-status-overdue', 'text-caption')).toBe('text-status-overdue text-caption')
    expect(cn('text-meta text-secondary')).toBe('text-meta text-secondary')
  })

  it('lets a later type role replace an earlier one', () => {
    expect(cn('text-caption', 'text-meta')).toBe('text-meta')
  })

  it('lets a later colour replace an earlier colour', () => {
    expect(cn('text-danger', 'text-status-done')).toBe('text-status-done')
  })

  it('keeps the last radius role', () => {
    expect(cn('rounded-control', 'rounded-card')).toBe('rounded-card')
    expect(cn('rounded-card px-2', 'rounded-popover')).toBe('px-2 rounded-popover')
  })

  it('still merges the stock classes', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4')
    expect(cn('rounded-full', 'rounded-control')).toBe('rounded-control')
  })

  it('knows every role in the token contract', () => {
    const theme = tailwindTheme(loadTokens())
    expect([...FONT_SIZE_ROLES].sort()).toEqual(Object.keys(theme.fontSize).sort())
    expect([...RADIUS_ROLES].sort()).toEqual(Object.keys(theme.borderRadius).sort())
  })
})
