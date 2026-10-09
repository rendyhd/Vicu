import { describe, expect, it } from 'vitest'
import { loadTokens } from '../../../../scripts/gen-tokens.mjs'

/**
 * Asserts every pair of `contrast.rules` in test-fixtures/design-tokens-v1.json in both themes
 * (the Android repo asserts the same rules against its own data). Ratios are WCAG 2.x relative
 * luminance with the sRGB threshold 0.04045; a tint is the role at its alpha composited over
 * another role, each channel rounded half up to 8 bits before measuring.
 */
const tokens = loadTokens()
type Rgb = [number, number, number]
type Theme = 'light' | 'dark'

const toRgb = (hex: string): Rgb => {
  const m = /^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/.exec(hex)
  if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`)
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

const linear = (channel: number): number => {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

const luminance = ([r, g, b]: Rgb): number => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)

const contrastRatio = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** round(alpha * fg + (1 - alpha) * bg) per channel, half up (the epsilon settles exact ties). */
const composite = (fg: Rgb, alpha: number, bg: Rgb): Rgb =>
  fg.map((c, i) => Math.floor(alpha * c + (1 - alpha) * bg[i] + 0.5 + 1e-9)) as Rgb

const role = (name: string, theme: Theme): Rgb => {
  const def = tokens.roles[name]
  if (!def) throw new Error(`unknown role ${name}`)
  return toRgb(def[theme])
}

const background = (bg: (typeof tokens.contrast.rules)[number]['bg'][number], theme: Theme): Rgb =>
  typeof bg === 'string' ? role(bg, theme) : composite(role(bg.tint, theme), bg.alpha, role(bg.over, theme))

const label = (bg: (typeof tokens.contrast.rules)[number]['bg'][number]): string =>
  typeof bg === 'string' ? bg : `${bg.tint} at ${bg.alpha} over ${bg.over}`

describe('contrast maths', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 10)
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 10)
    // The 4.5 boundary: #767676 on white is the textbook just-passing grey (4.54).
    expect(contrastRatio(toRgb('#767676'), [255, 255, 255])).toBeCloseTo(4.54, 2)
    expect(contrastRatio(toRgb('#777777'), [255, 255, 255])).toBeLessThan(4.5)
  })

  it('rounds a tint half up per channel', () => {
    // 8% of 215 over 255 is 251.8 -> 252; of 0 it is 234.6 -> 235; of 21 it is 236.28 -> 236.
    expect(composite([215, 0, 21], 0.08, [255, 255, 255])).toEqual([252, 235, 236])
    // An exact tie (0.5 * 1 + 0.5 * 0 = 0.5) goes up.
    expect(composite([1, 1, 1], 0.5, [0, 0, 0])).toEqual([1, 1, 1])
  })

  it('reads the documented figure for the filled button', () => {
    expect(contrastRatio(role('on.accent', 'light'), role('accent.fill', 'light'))).toBeCloseTo(5.48, 2)
  })

  it('would catch a failure: tertiary text is not readable text', () => {
    expect(contrastRatio(role('text.tertiary', 'light'), role('bg.page', 'light'))).toBeLessThan(4.5)
    expect(contrastRatio(role('palette.yellow', 'light'), role('bg.page', 'light'))).toBeLessThan(3)
  })
})

describe.each(['light', 'dark'] as const)('contrast rules, %s theme', (theme) => {
  it('has the rules the design system document names', () => {
    expect(tokens.contrast.rules.length).toBeGreaterThanOrEqual(15)
  })

  for (const rule of tokens.contrast.rules) {
    describe(rule.name, () => {
      for (const bg of rule.bg) {
        it(`${rule.fg} on ${label(bg)} is at least ${rule.min}:1`, () => {
          expect(contrastRatio(role(rule.fg, theme), background(bg, theme))).toBeGreaterThanOrEqual(rule.min)
        })
      }
    })
  }
})
