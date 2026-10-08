import type { CSSProperties } from 'react'
import { normalizeHex } from './constants'

// The label chip colours of the contract (test-fixtures/design-tokens-v1.json `labelChip`,
// docs/design-system-v1.md section 2): the fill is the label colour at 12% over bg.page; the text is
// the label colour kept in hue and saturation (HSL) and moved in lightness, one percent at a time,
// until it has 4.5:1 against that fill. Android runs the same steps on the same vectors.

/** bg.page of each theme, the surface the tint is computed over (tokens `roles`). */
const BG_PAGE = { light: [0xff, 0xff, 0xff], dark: [0x1c, 0x1c, 0x1e] } as const
export const LABEL_TINT_ALPHA = 0.12
export const LABEL_MIN_CONTRAST = 4.5

const NO_COLOR: CSSProperties = { backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' }
const cache = new Map<string, CSSProperties>()

type Rgb = readonly [number, number, number]

const toHex = (rgb: Rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`
const parseHex = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]
/** Round half up, the same on every platform (the epsilon makes exact ties round up). */
const round8 = (v: number) => Math.floor(v + 0.5 + 1e-9)

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function toHsl([r, g, b]: Rgb): { h: number; s: number; l: number } {
  const rf = r / 255
  const gf = g / 255
  const bf = b / 255
  const max = Math.max(rf, gf, bf)
  const min = Math.min(rf, gf, bf)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rf) h = ((gf - bf) / d) % 6
  else if (max === gf) h = (bf - rf) / d + 2
  else h = (rf - gf) / d + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [round8((r + m) * 255), round8((g + m) * 255), round8((b + m) * 255)]
}

/** The fill of a chip over bg.page, as the contract defines it ("#RRGGBB"), or null for no colour. */
export function labelChipTint(rawHex: string | undefined, isDark: boolean): string | null {
  const hex = normalizeHex(rawHex)
  if (!hex) return null
  const bg = BG_PAGE[isDark ? 'dark' : 'light']
  const label = parseHex(hex)
  const tint = label.map((c, i) => round8(LABEL_TINT_ALPHA * c + (1 - LABEL_TINT_ALPHA) * bg[i]))
  return toHex(tint as unknown as Rgb)
}

/** The text colour of a chip: the label colour moved in lightness until it passes 4.5:1 on the tint. */
export function labelChipText(rawHex: string | undefined, isDark: boolean): string | null {
  const hex = normalizeHex(rawHex)
  if (!hex) return null
  const tint = parseHex(labelChipTint(hex, isDark) as string)
  const label = parseHex(hex)
  const { h, s, l } = toHsl(label)
  let candidate: Rgb = label
  for (let n = 0; n <= 100; n++) {
    const lightness = Math.min(1, Math.max(0, isDark ? l + n / 100 : l - n / 100))
    candidate = n === 0 ? label : fromHsl(h, s, lightness)
    if (contrast(candidate, tint) >= LABEL_MIN_CONTRAST) break
  }
  return toHex(candidate)
}

function build(hex: string, isDark: boolean): CSSProperties {
  const [r, g, b] = parseHex(hex)
  return {
    // The fill stays translucent so a hovered or selected row shows through; over bg.page it is the contract tint.
    backgroundColor: `rgba(${r}, ${g}, ${b}, ${LABEL_TINT_ALPHA})`,
    color: labelChipText(hex, isDark) as string,
  }
}

/**
 * The colors of a label chip. The result is remembered per color and theme, so the same object comes
 * back for every chip of that color (no work per row per render, and an unchanged `style` prop for
 * React), and the theme is an argument, not a read of the document class (D-REN-5).
 */
export function labelChipStyle(rawHex: string | undefined, isDark: boolean): CSSProperties {
  const hex = normalizeHex(rawHex)
  if (!hex) return NO_COLOR
  const key = `${isDark ? 'd' : 'l'}${hex.toLowerCase()}`
  let style = cache.get(key)
  if (!style) {
    style = build(hex, isDark)
    cache.set(key, style)
  }
  return style
}
