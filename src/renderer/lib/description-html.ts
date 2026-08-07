const SAFE_LINK_PROTOCOL = /^(https?:|mailto:)/i
const BARE_HOST = /^(?:localhost|(?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?(?:[/?#]\S*)?$/i

export function isAllowedDescriptionUrl(raw: string | null | undefined): boolean {
  const value = raw?.trim()
  if (!value || !SAFE_LINK_PROTOCOL.test(value) || /[\u0000-\u001f\u007f\s]/.test(value)) return false

  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:'
  } catch {
    return false
  }
}

export function normalizeEditableLink(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  if (isAllowedDescriptionUrl(value)) return value

  const withScheme = BARE_HOST.test(value) ? `https://${value}` : ''
  return isAllowedDescriptionUrl(withScheme) ? withScheme : null
}

/**
 * Quick View intentionally has a plain-text editor. Any structured markup must
 * be edited in the main TipTap editor so a title-only edit cannot flatten it.
 */
export function hasRichDescriptionBody(html: string | null | undefined): boolean {
  if (!html) return false
  return /<(?:strong|b|em|i|s|strike|del|u|a|code|pre|ul|ol|li|h[1-6]|blockquote|hr|table|thead|tbody|tfoot|tr|th|td|span|div|label|input)\b|data-type\s*=|data-checked\s*=/i.test(html)
}
