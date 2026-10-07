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

/** Href safe to open from the notes editor (same schemes as editable links). */
export function resolveOpenableDescriptionHref(raw: string | null | undefined): string | null {
  if (!raw) return null
  return normalizeEditableLink(raw)
}

/**
 * Quick View intentionally has a plain-text editor. Any structured markup must
 * be edited in the main TipTap editor so a title-only edit cannot flatten it.
 */
export function hasRichDescriptionBody(html: string | null | undefined): boolean {
  if (!html) return false
  return /<(?:strong|b|em|i|s|strike|del|u|a|code|pre|ul|ol|li|h[1-6]|blockquote|hr|table|thead|tbody|tfoot|tr|th|td|span|div|label|input)\b|data-type\s*=|data-checked\s*=/i.test(html)
}

/** Text as it is shown inside HTML: the characters that can start markup or end an attribute are escaped. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Plain text typed into a plain-text box (Quick Entry notes, Quick View's description field) as
 * description HTML: escaped, one `<p>` per line, lines joined by a newline, blank lines and the
 * whitespace around a line dropped. Empty input is the canonical empty body, the empty string.
 * This is the shape the description format contract gives legacy plain text (`legacy-text` and
 * `legacy-lines` in test-fixtures/description-format-v1.json), so every surface that writes a
 * plain description produces the same HTML whether or not a link follows it.
 */
export function plainTextToDescriptionHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('\n')
}

/**
 * Description HTML with a newline after every paragraph and every `<br>`, so that reading it as
 * text (DOM `textContent`) keeps one line per paragraph instead of running them together.
 */
export function withLineBreaksAsNewlines(html: string): string {
  return html.replace(/(<br\s*\/?>|<\/p\s*>)/gi, '$1\n')
}

/** The text of a description, as lines: trimmed, without blank lines (the inverse of plainTextToDescriptionHtml). */
export function plainTextFromDescriptionLines(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n')
}
