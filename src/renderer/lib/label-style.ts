import type { CSSProperties } from 'react'
import { normalizeHex } from './constants'

const NO_COLOR: CSSProperties = { backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' }
const cache = new Map<string, CSSProperties>()

function build(hex: string, isDark: boolean): CSSProperties {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  if (isDark) {
    const lr = Math.min(255, r + Math.round((255 - r) * 0.45))
    const lg = Math.min(255, g + Math.round((255 - g) * 0.45))
    const lb = Math.min(255, b + Math.round((255 - b) * 0.45))
    return { backgroundColor: `rgba(${r}, ${g}, ${b}, 0.12)`, color: `rgb(${lr}, ${lg}, ${lb})` }
  }
  return { backgroundColor: `rgba(${r}, ${g}, ${b}, 0.12)`, color: hex }
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
