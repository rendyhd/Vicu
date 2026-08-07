import DOMPurify from 'dompurify'
import { isAllowedDescriptionUrl } from './description-html'

const ALLOWED_TAGS = [
  'p', 'br',
  'strong', 'b', 'em', 'i', 's', 'strike', 'del', 'u',
  'a',
  'code', 'pre',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote',
  'hr',
  'span', 'div', 'label', 'input',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
]

const ALLOWED_ATTR = [
  'href', 'title',
  'data-type', 'data-checked',
  'contenteditable', 'type', 'checked', 'disabled',
  'start', 'colspan', 'rowspan',
]

const ALLOWED_ATTR_BY_TAG: Record<string, ReadonlySet<string>> = {
  a: new Set(['href', 'title']),
  ol: new Set(['start']),
  ul: new Set(['data-type']),
  li: new Set(['data-type', 'data-checked']),
  label: new Set(['contenteditable']),
  input: new Set(['type', 'checked']),
  th: new Set(['colspan', 'rowspan']),
  td: new Set(['colspan', 'rowspan']),
}

let hooksInstalled = false

function ensureHooks(): void {
  if (hooksInstalled) return
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return
    const tag = node.tagName.toLowerCase()
    const allowedAttributes = ALLOWED_ATTR_BY_TAG[tag] ?? new Set<string>()
    for (const attribute of Array.from(node.attributes)) {
      if (!allowedAttributes.has(attribute.name)) node.removeAttribute(attribute.name)
    }

    if (tag === 'a') {
      const href = node.getAttribute('href')
      if (!isAllowedDescriptionUrl(href)) node.removeAttribute('href')
      // Navigation behavior is renderer-only and is never persisted.
      node.removeAttribute('target')
      node.removeAttribute('rel')
    }

    const dataType = node.getAttribute('data-type')
    const validDataType =
      (tag === 'ul' && dataType === 'taskList') ||
      (tag === 'li' && dataType === 'taskItem')
    if (dataType && !validDataType) {
      node.removeAttribute('data-type')
    }
    const dataChecked = node.getAttribute('data-checked')
    if (
      dataChecked &&
      (tag !== 'li' || node.getAttribute('data-type') !== 'taskItem' || !['true', 'false'].includes(dataChecked))
    ) {
      node.removeAttribute('data-checked')
    }
    if (node.hasAttribute('contenteditable') && node.getAttribute('contenteditable') !== 'false') {
      node.removeAttribute('contenteditable')
    }

    if (tag === 'input') {
      const taskItem = node.closest('li[data-type="taskItem"]')
      if (node.getAttribute('type') !== 'checkbox' || !taskItem) {
        node.remove()
        return
      }
    }
    if (tag === 'label' && !node.closest('li[data-type="taskItem"]')) {
      node.replaceWith(...Array.from(node.childNodes))
      return
    }

    if (tag === 'ol' && node.hasAttribute('start') && !/^-?\d+$/.test(node.getAttribute('start') ?? '')) {
      node.removeAttribute('start')
    }
    if (tag === 'th' || tag === 'td') {
      for (const attribute of ['colspan', 'rowspan']) {
        const value = Number(node.getAttribute(attribute))
        if (!Number.isInteger(value) || value < 1 || value > 100) node.removeAttribute(attribute)
      }
    }
  })
  hooksInstalled = true
}

export function sanitizeTaskHtmlForStorage(raw: string | null | undefined): string {
  if (!raw) return ''
  ensureHooks()
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  })
}

export function sanitizeTaskHtml(raw: string | null | undefined): string {
  const sanitized = sanitizeTaskHtmlForStorage(raw)
  if (!sanitized || typeof document === 'undefined') return sanitized

  const template = document.createElement('template')
  template.innerHTML = sanitized
  template.content.querySelectorAll('a[href]').forEach((anchor) => {
    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer')
  })
  template.content.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.setAttribute('disabled', '')
  })
  return template.innerHTML
}
