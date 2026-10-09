import { describe, expect, it } from 'vitest'
import { loadTokens } from '../../../../scripts/gen-tokens.mjs'
import {
  TOKEN_CHIP_ALPHA,
  TOKEN_CHIP_CLASSES,
  TOKEN_CHIP_ROLE,
  TOKEN_HIGHLIGHT_ALPHA,
  tokenHighlightBackground,
} from '../../lib/token-chip-colors'

/**
 * The parse chips (date, label, project, recurrence) draw their fill as a role at 12% (20% in dark)
 * and their text as that role mixed half and half with `text`. This asserts the text passes 4.5:1
 * on the fill over every surface in both themes, with the same arithmetic as contrast.test.ts
 * (WCAG 2.x, tint rounded half up to 8 bits); the sRGB mix is what `color-mix(in srgb, a, b)` does.
 */
const tokens = loadTokens()
type Rgb = [number, number, number]
type Theme = 'light' | 'dark'

const toRgb = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const linear = (channel: number) => {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = ([r, g, b]: Rgb) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const composite = (fg: Rgb, alpha: number, bg: Rgb) => fg.map((c, i) => Math.floor(alpha * c + (1 - alpha) * bg[i] + 0.5 + 1e-9)) as Rgb
const mix = (a: Rgb, b: Rgb) => a.map((c, i) => Math.round((c + b[i]) / 2)) as Rgb

const role = (name: string, theme: Theme) => toRgb(tokens.roles[name][theme])
// accent-blue is the text-safe accent role, the others are palette colours.
const ROLE_OF: Record<string, string> = {
  'accent-blue': 'accent',
  'accent-green': 'palette.green',
  'accent-orange': 'palette.orange',
  'accent-purple': 'palette.purple',
  'accent-red': 'palette.red',
}
const SURFACES = ['bg.page', 'bg.card', 'bg.selected', 'bg.hover']

describe('the parse chip colours', () => {
  it('give each chip type its own role, written the same in the class, the table and the highlight', () => {
    for (const [type, classes] of Object.entries(TOKEN_CHIP_CLASSES)) {
      const name = TOKEN_CHIP_ROLE[type as keyof typeof TOKEN_CHIP_ROLE]
      expect(classes, type).toContain(`bg-${name}/12`)
      expect(classes, type).toContain(`dark:bg-${name}/20`)
      expect(classes, type).toContain(`rgb(var(--${name}-rgb))`)
      expect(classes, type).toContain('var(--text-primary)')
    }
    expect(new Set(Object.values(TOKEN_CHIP_ROLE)).size).toBe(5)
  })

  it('has the alphas the classes spell', () => {
    expect(TOKEN_CHIP_ALPHA).toEqual({ light: 0.12, dark: 0.2 })
    expect(tokenHighlightBackground('date', false)).toBe(`rgb(var(--accent-green-rgb) / ${TOKEN_HIGHLIGHT_ALPHA.light})`)
    expect(tokenHighlightBackground('priority', true)).toBe(`rgb(var(--accent-red-rgb) / ${TOKEN_HIGHLIGHT_ALPHA.dark})`)
  })

  describe.each(['light', 'dark'] as const)('%s theme', (theme) => {
    for (const type of Object.keys(TOKEN_CHIP_CLASSES)) {
      const name = TOKEN_CHIP_ROLE[type as keyof typeof TOKEN_CHIP_ROLE]
      for (const surface of SURFACES) {
        it(`${type} text on its fill over ${surface} is at least 4.5:1`, () => {
          const fill = role(ROLE_OF[name], theme)
          const tint = composite(fill, TOKEN_CHIP_ALPHA[theme], role(surface, theme))
          const text = mix(fill, role('text', theme))
          expect(contrast(text, tint)).toBeGreaterThanOrEqual(4.5)
        })
      }
    }
  })
})
