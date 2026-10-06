export const NULL_DATE = '0001-01-01T00:00:00Z'

/** Normalize a hex color: ensure # prefix, handle missing/invalid values. */
export function normalizeHex(hex: string | undefined): string | undefined {
  if (!hex) return undefined
  const h = hex.startsWith('#') ? hex : `#${hex}`
  return /^#[0-9a-fA-F]{6}$/.test(h) ? h : undefined
}
