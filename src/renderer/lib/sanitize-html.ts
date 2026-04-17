import DOMPurify from 'dompurify'

const ALLOWED_TAGS = [
  'p', 'br',
  'strong', 'em', 's', 'u',
  'a',
  'code', 'pre',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote',
  'hr',
  'span', 'div',
]

const ALLOWED_ATTR = [
  'href', 'target', 'rel',
  'class',
  'data-type', 'data-checked',
]

let hooksInstalled = false

function ensureHooks(): void {
  if (hooksInstalled) return
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node instanceof HTMLAnchorElement) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
  hooksInstalled = true
}

export function sanitizeTaskHtml(raw: string | null | undefined): string {
  if (!raw) return ''
  ensureHooks()
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  })
}
