import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LABEL_MIN_CONTRAST, LABEL_TINT_ALPHA, labelChipStyle, labelChipText, labelChipTint } from '../label-style'
import { currentPathname } from '../route-path'

interface Vector {
  label: string
  source: string
  light: { text: string; tint: string }
  dark: { text: string; tint: string }
}
const tokens = JSON.parse(readFileSync(resolve(__dirname, '..', '..', '..', '..', 'test-fixtures', 'design-tokens-v1.json'), 'utf8'))
const vectors = tokens.labelChip.vectors as Vector[]

function ratio(a: string, b: string): number {
  const lum = (hex: string) => {
    const lin = (i: number) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5)
  }
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

describe('label chip colors (card 2.3a, contract labelChip)', () => {
  it('runs the constants of the token file', () => {
    expect(LABEL_TINT_ALPHA).toBe(tokens.labelChip.tintAlpha)
    expect(LABEL_MIN_CONTRAST).toBe(tokens.labelChip.minContrast)
    expect(tokens.roles['bg.page'].light).toBe('#FFFFFF')
    expect(tokens.roles['bg.page'].dark).toBe('#1C1C1E')
  })

  it('passes every vector of the token file in both themes', () => {
    expect(vectors.length).toBeGreaterThan(20)
    for (const v of vectors) {
      for (const theme of ['light', 'dark'] as const) {
        const dark = theme === 'dark'
        expect(labelChipTint(v.label, dark), `tint ${v.label} ${theme}`).toBe(v[theme].tint)
        expect(labelChipText(v.label, dark), `text ${v.label} ${theme}`).toBe(v[theme].text)
      }
    }
  })

  it('gives the vectors 4.5:1 text on the tint, except where the lightness range runs out', () => {
    for (const v of vectors) {
      for (const theme of ['light', 'dark'] as const) {
        if (ratio(v[theme].text, v[theme].tint) < 4.5) {
          expect(['#FFFFFF', '#000000', '#808080'], `${v.label} ${theme}`).toContain(v.label)
        }
      }
    }
  })

  it('tints the background at 12% of the label and sets the derived text colour', () => {
    expect(labelChipStyle('#ff8800', false)).toEqual({ backgroundColor: 'rgba(255, 136, 0, 0.12)', color: labelChipText('#ff8800', false) })
    expect(labelChipStyle('#FF851B', true)).toEqual({ backgroundColor: 'rgba(255, 133, 27, 0.12)', color: '#FF851B' })
  })

  it('accepts a color without the leading #', () => {
    expect(labelChipStyle('ff8800', false)).toEqual(labelChipStyle('#ff8800', false))
  })

  it('falls back to the neutral chip for a missing or invalid color, in both themes', () => {
    for (const bad of [undefined, '', 'red', '#12', '#gggggg']) {
      for (const dark of [false, true]) {
        expect(labelChipStyle(bad, dark)).toEqual({ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' })
        expect(labelChipText(bad, dark)).toBeNull()
        expect(labelChipTint(bad, dark)).toBeNull()
      }
    }
  })

  it('returns the same object for the same color and theme, a different one per theme', () => {
    const light = labelChipStyle('#3366cc', false)
    expect(labelChipStyle('#3366cc', false)).toBe(light)
    expect(labelChipStyle('#3366CC', false)).toBe(light)
    expect(labelChipStyle('3366cc', false)).toBe(light)
    expect(labelChipStyle('#3366cc', true)).not.toBe(light)
    expect(labelChipStyle('#3366cc', true)).toBe(labelChipStyle('#3366cc', true))
  })
})

describe('current path without subscribing to the router', () => {
  it('is the path of the innermost match, read when asked', () => {
    const router = { state: { matches: [{ pathname: '/' }, { pathname: '/project/4' }] } }
    expect(currentPathname(router)).toBe('/project/4')
    router.state = { matches: [{ pathname: '/' }, { pathname: '/today' }] }
    expect(currentPathname(router)).toBe('/today')
  })

  it('is empty before the first match', () => {
    expect(currentPathname({ state: { matches: [] } })).toBe('')
  })
})
