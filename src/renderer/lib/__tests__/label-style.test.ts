import { describe, expect, it } from 'vitest'
import { labelChipStyle } from '../label-style'
import { currentPathname } from '../route-path'

describe('label chip colors (D-REN-5)', () => {
  it('tints the background and uses the label color for the text in the light theme', () => {
    expect(labelChipStyle('#ff8800', false)).toEqual({ backgroundColor: 'rgba(255, 136, 0, 0.12)', color: '#ff8800' })
  })

  it('lightens the text toward white in the dark theme', () => {
    // 0 + (255 - 0) * 0.45 = 115 (rounded)
    expect(labelChipStyle('#000000', true)).toEqual({ backgroundColor: 'rgba(0, 0, 0, 0.12)', color: 'rgb(115, 115, 115)' })
    expect(labelChipStyle('#ffffff', true)).toEqual({ backgroundColor: 'rgba(255, 255, 255, 0.12)', color: 'rgb(255, 255, 255)' })
  })

  it('accepts a color without the leading #', () => {
    expect(labelChipStyle('ff8800', false)).toEqual(labelChipStyle('#ff8800', false))
  })

  it('falls back to the neutral chip for a missing or invalid color, in both themes', () => {
    for (const bad of [undefined, '', 'red', '#12', '#gggggg']) {
      for (const dark of [false, true]) {
        expect(labelChipStyle(bad, dark)).toEqual({ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' })
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
