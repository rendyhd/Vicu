/**
 * Markdown input (docs/description-format-v1.md, "Markdown input"; vectors `markdown` in
 * test-fixtures/description-format-v1.json, the same in vicu-android's `MarkdownInput.kt`).
 *
 * Markdown is only a way of writing notes: pasted text that uses it becomes the description HTML
 * the editors store. Nothing is ever stored as Markdown and stored notes are never read as it.
 * The subset is deliberately small and every rule is spelled out, so both apps give the same HTML.
 */

export interface MarkdownInput {
  /** Description HTML: top-level blocks joined by a newline; '' for blank input. */
  html: string
  /** True when the text used Markdown syntax (a bare URL alone does not count). */
  markdown: boolean
}

const PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** A link destination Markdown input may use: http(s) with something after `//`, or mailto. */
export function markdownHref(raw: string): string | null {
  const value = raw.trim()
  if (!/^(?:https?:\/\/[^\s\u0000-\u001f\u007f]+|mailto:[^\s\u0000-\u001f\u007f]+)$/i.test(value)) return null
  return value
}

const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch)
const isSpace = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch)

function runLength(text: string, at: number, ch: string): number {
  let end = at
  while (text[end] === ch) end++
  return end - at
}

/** Where the code span opened by the backtick run at `at` ends (index after its closing run), or -1. */
function codeSpanEnd(text: string, at: number): number {
  const n = runLength(text, at, '`')
  let i = at + n
  while (i < text.length) {
    if (text[i] === '`') {
      const m = runLength(text, i, '`')
      if (m === n) return i + m
      i += m
    } else {
      i++
    }
  }
  return -1
}

interface Link {
  end: number
  text: string
  href: string
  title: string | null
}

/** A `[text](destination "title")` starting at `at`, or null. */
function parseLink(text: string, at: number): Link | null {
  if (text[at] !== '[') return null
  let depth = 0
  let close = -1
  for (let i = at; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\' && i + 1 < text.length) {
      i++
      continue
    }
    if (ch === '`') {
      const end = codeSpanEnd(text, i)
      if (end > 0) {
        i = end - 1
        continue
      }
    }
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  if (close < 0 || text[close + 1] !== '(') return null
  let i = close + 2
  while (text[i] === ' ' || text[i] === '\t') i++
  let destination = ''
  if (text[i] === '<') {
    const end = text.indexOf('>', i + 1)
    if (end < 0) return null
    destination = text.slice(i + 1, end)
    i = end + 1
  } else {
    let parens = 0
    const start = i
    while (i < text.length && !/\s/.test(text[i])) {
      if (text[i] === '(') parens++
      else if (text[i] === ')') {
        if (parens === 0) break
        parens--
      }
      i++
    }
    destination = text.slice(start, i)
  }
  let title: string | null = null
  const beforeTitle = i
  while (text[i] === ' ' || text[i] === '\t') i++
  if (i > beforeTitle && (text[i] === '"' || text[i] === "'")) {
    const quote = text[i]
    const end = text.indexOf(quote, i + 1)
    if (end < 0) return null
    title = text.slice(i + 1, end)
    i = end + 1
    while (text[i] === ' ' || text[i] === '\t') i++
  }
  if (text[i] !== ')') return null
  const href = markdownHref(destination)
  if (!href) return null
  return { end: i + 1, text: text.slice(at + 1, close), href, title }
}

/** A bare http(s) URL at `at`, as [end, href], or null. */
function bareUrl(text: string, at: number): [number, string] | null {
  const match = /^https?:\/\/[^\s<]+/i.exec(text.slice(at))
  if (!match) return null
  let url = match[0]
  for (;;) {
    const last = url[url.length - 1]
    if (/[.,:;!?'"*_~]/.test(last)) url = url.slice(0, -1)
    else if (last === ')' && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)) url = url.slice(0, -1)
    else break
  }
  const href = markdownHref(url)
  return href && url.length > url.indexOf('//') + 2 ? [at + url.length, href] : null
}

interface Closer {
  /** Where the content ends. */
  contentEnd: number
  /** Index after the closing delimiter. */
  end: number
}

/**
 * The closing delimiter for an opener of `need` characters `ch` whose content starts at `from`.
 * Code spans and escapes are skipped. A closing run is right-flanking (no space before it; for
 * `_`, no letter or digit after it) and long enough: exactly `need`, or longer, when it takes its
 * last `need` characters; a run of one or two never closes a `***` opener, a run of two never
 * closes a `*` opener.
 */
function findCloser(text: string, from: number, ch: string, need: number): Closer | null {
  let i = from
  while (i < text.length) {
    const c = text[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '`') {
      const end = codeSpanEnd(text, i)
      i = end > 0 ? end : i + runLength(text, i, '`')
      continue
    }
    if (c !== ch) {
      i++
      continue
    }
    const m = runLength(text, i, ch)
    const runEnd = i + m
    const fits = need === 1 ? m === 1 || m >= 3 : m >= need
    const rightFlanking = !isSpace(text[i - 1]) && (ch !== '_' || !isWordChar(text[runEnd]))
    if (fits && rightFlanking && i > from) {
      return { contentEnd: runEnd - need, end: runEnd }
    }
    i = runEnd
  }
  return null
}

interface InlineState {
  markdown: boolean
}

function inline(text: string, state: InlineState, inLink: boolean): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]

    if (ch === '\\' && i + 1 < text.length && PUNCTUATION.test(text[i + 1])) {
      out += escapeText(text[i + 1])
      state.markdown = true
      i += 2
      continue
    }

    if (ch === '`') {
      const n = runLength(text, i, '`')
      const end = codeSpanEnd(text, i)
      if (end < 0) {
        out += escapeText(text.slice(i, i + n))
        i += n
        continue
      }
      let code = text.slice(i + n, end - n)
      if (code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') code = code.slice(1, -1)
      out += `<code>${escapeText(code)}</code>`
      state.markdown = true
      i = end
      continue
    }

    if (ch === '!' && text[i + 1] === '[' && !inLink) {
      const image = parseLink(text, i + 1)
      if (image) {
        // An image is not part of the format: it stays as its text.
        out += escapeText(text.slice(i, image.end))
        i = image.end
        continue
      }
    }

    if (ch === '[' && !inLink) {
      const link = parseLink(text, i)
      if (link) {
        const title = link.title !== null ? ` title="${escapeText(link.title)}"` : ''
        out += `<a href="${escapeText(link.href)}"${title}>${inline(link.text, state, true)}</a>`
        state.markdown = true
        i = link.end
        continue
      }
    }

    if (ch === '<' && !inLink) {
      const end = text.indexOf('>', i + 1)
      const href = end > 0 ? markdownHref(text.slice(i + 1, end)) : null
      if (href && !/\s/.test(text.slice(i + 1, end))) {
        out += `<a href="${escapeText(href)}">${escapeText(text.slice(i + 1, end))}</a>`
        state.markdown = true
        i = end + 1
        continue
      }
    }

    if ((ch === 'h' || ch === 'H') && !inLink && (i === 0 || /[\s(]/.test(text[i - 1]))) {
      const url = bareUrl(text, i)
      if (url) {
        out += `<a href="${escapeText(url[1])}">${escapeText(text.slice(i, url[0]))}</a>`
        i = url[0]
        continue
      }
    }

    if (ch === '~' && runLength(text, i, '~') === 2 && !isSpace(text[i + 2])) {
      const closer = findStrikeCloser(text, i + 2)
      if (closer) {
        out += `<s>${inline(text.slice(i + 2, closer.contentEnd), state, inLink)}</s>`
        state.markdown = true
        i = closer.end
        continue
      }
    }

    if (ch === '*' || ch === '_') {
      const n = runLength(text, i, ch)
      const leftFlanking = !isSpace(text[i + n]) && (ch !== '_' || !isWordChar(text[i - 1]))
      if (leftFlanking) {
        const emphasis = emphasisAt(text, i, ch, Math.min(n, 3), n, state, inLink)
        if (emphasis) {
          out += emphasis[0]
          i = emphasis[1]
          continue
        }
      }
      out += escapeText(text.slice(i, i + n))
      i += n
      continue
    }

    out += escapeText(ch)
    i++
  }
  return out
}

/**
 * Emphasis opened by the run of `n` characters at `at`, using its last `k` (3, 2 or 1; the
 * characters before them are text). `***` that finds no closer of three tries `**`, then `*`.
 */
function emphasisAt(
  text: string,
  at: number,
  ch: string,
  k: number,
  n: number,
  state: InlineState,
  inLink: boolean,
): [string, number] | null {
  for (let need = k; need >= 1; need--) {
    const contentStart = at + n
    const closer = findCloser(text, contentStart, ch, need)
    if (!closer || closer.contentEnd <= contentStart) continue
    const lead = escapeText(text.slice(at, at + n - need))
    const inner = inline(text.slice(contentStart, closer.contentEnd), state, inLink)
    state.markdown = true
    const html =
      need === 3 ? `<em><strong>${inner}</strong></em>` : need === 2 ? `<strong>${inner}</strong>` : `<em>${inner}</em>`
    return [lead + html, closer.end]
  }
  return null
}

function findStrikeCloser(text: string, from: number): Closer | null {
  let i = from
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2
      continue
    }
    if (text[i] === '`') {
      const end = codeSpanEnd(text, i)
      i = end > 0 ? end : i + runLength(text, i, '`')
      continue
    }
    if (text[i] === '~') {
      const m = runLength(text, i, '~')
      if (m === 2 && i > from && !isSpace(text[i - 1])) return { contentEnd: i, end: i + 2 }
      i += m
      continue
    }
    i++
  }
  return null
}

// ---- Blocks -----------------------------------------------------------------------------------

type ListKind = 'bullet' | 'ordered' | 'task'

interface ListItem {
  paragraphs: string[]
  checked: boolean
  lists: List[]
}

interface List {
  kind: ListKind
  indent: number
  items: ListItem[]
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const RULE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
const QUOTE = /^ {0,3}>[ \t]?(.*)$/
const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/
const TASK = /^\[([ xX])\](?:[ \t]+(.*))?$/

/** Leading whitespace in columns, a tab counting four. */
function indentOf(line: string): number {
  let columns = 0
  for (const ch of line) {
    if (ch === ' ') columns++
    else if (ch === '\t') columns += 4
    else break
  }
  return columns
}

function listHtml(list: List, state: InlineState): string {
  const items = list.items.map((item) => {
    const body = item.paragraphs.map((p) => `<p>${inline(p, state, false)}</p>`).join('')
    const nested = item.lists.map((child) => listHtml(child, state)).join('')
    if (list.kind === 'task') {
      const box = item.checked ? '<input type="checkbox" checked="checked">' : '<input type="checkbox">'
      return `<li data-type="taskItem" data-checked="${item.checked}"><label contenteditable="false">${box}<span></span></label><div>${body}${nested}</div></li>`
    }
    return `<li>${body}${nested}</li>`
  })
  if (list.kind === 'task') return `<ul data-type="taskList">${items.join('')}</ul>`
  return list.kind === 'ordered' ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`
}

/**
 * What a paste of `text` inserts when it is Markdown (contract "Markdown input", Paste): one
 * paragraph's inline HTML into the current line, or blocks; null when the text is not Markdown and
 * pastes as plain text. Blocks are joined without the newline, which would be read as text.
 */
export function markdownPasteContent(text: string): { inline: boolean; html: string } | null {
  const result = markdownToDescriptionHtml(text)
  if (!result.markdown || result.html === '') return null
  const single = /^<p>(.*)<\/p>$/s.exec(result.html)
  if (single && !single[1].includes('</p>')) return { inline: true, html: single[1] }
  return { inline: false, html: result.html.replace(/(<\/(?:p|h[1-6]|blockquote|ul|ol|pre)>|<hr>)\n</g, '$1<') }
}

/** Markdown text as description HTML (see the module comment for where the rules live). */
export function markdownToDescriptionHtml(source: string): MarkdownInput {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const state: InlineState = { markdown: false }
  const blocks: string[] = []

  /** Open lists, outermost first; the first is a top-level list. */
  let stack: List[] = []
  let quote: string[] | null = null

  const closeList = () => {
    if (stack.length) blocks.push(listHtml(stack[0], state))
    stack = []
  }
  const closeQuote = () => {
    if (quote?.length) blocks.push(`<blockquote>${quote.map((p) => `<p>${inline(p, state, false)}</p>`).join('')}</blockquote>`)
    quote = null
  }
  const lastItem = (): ListItem | undefined => {
    const top = stack[stack.length - 1]
    return top?.items[top.items.length - 1]
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      closeQuote()
      // A blank line ends a list unless the next text line is an item or belongs to the last one.
      let next = i + 1
      while (next < lines.length && lines[next].trim() === '') next++
      const following = lines[next]
      const keepsList =
        following !== undefined &&
        stack.length > 0 &&
        !RULE.test(following) &&
        (ITEM.test(following) || indentOf(following) > stack[0].indent)
      if (!keepsList) closeList()
      i = next
      continue
    }

    const item = !RULE.test(line) ? ITEM.exec(line) : null
    if (item) {
      closeQuote()
      const indent = indentOf(item[1])
      let content = item[3] ?? ''
      let kind: ListKind = /\d/.test(item[2]) ? 'ordered' : 'bullet'
      let checked = false
      const task = kind === 'bullet' ? TASK.exec(content) : null
      if (task) {
        kind = 'task'
        checked = task[1] !== ' '
        content = task[2] ?? ''
      }
      state.markdown = true
      const entry: ListItem = { paragraphs: [content.trim()], checked, lists: [] }

      while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop()
      const top = stack[stack.length - 1]
      if (!top) {
        stack = [{ kind, indent, items: [entry] }]
      } else if (indent > top.indent) {
        const child: List = { kind, indent, items: [entry] }
        top.items[top.items.length - 1].lists.push(child)
        stack.push(child)
      } else if (top.kind === kind) {
        top.items.push(entry)
      } else if (stack.length === 1) {
        closeList()
        stack = [{ kind, indent, items: [entry] }]
      } else {
        stack.pop()
        const sibling: List = { kind, indent, items: [entry] }
        const parent = stack[stack.length - 1]
        parent.items[parent.items.length - 1].lists.push(sibling)
        stack.push(sibling)
      }
      i++
      continue
    }

    if (stack.length && indentOf(line) > stack[0].indent) {
      // More indented than the top-level items: text of the nearest item it is indented under.
      const indent = indentOf(line)
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
      lastItem()!.paragraphs.push(line.trim())
      i++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) {
      closeList()
      closeQuote()
      const marker = fence[1]
      const indent = indentOf(line)
      const code: string[] = []
      i++
      while (i < lines.length) {
        const closing = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`)
        if (closing.test(lines[i])) {
          i++
          break
        }
        let text = lines[i]
        let strip = indent
        while (strip > 0 && text.startsWith(' ')) {
          text = text.slice(1)
          strip--
        }
        code.push(text)
        i++
      }
      blocks.push(`<pre><code>${escapeText(code.join('\n'))}</code></pre>`)
      state.markdown = true
      continue
    }

    if (RULE.test(line)) {
      closeList()
      closeQuote()
      blocks.push('<hr>')
      state.markdown = true
      i++
      continue
    }

    const heading = HEADING.exec(line)
    if (heading && heading[2].trim() !== '') {
      closeList()
      closeQuote()
      const level = heading[1].length
      blocks.push(`<h${level}>${inline(heading[2].trim(), state, false)}</h${level}>`)
      state.markdown = true
      i++
      continue
    }

    const quoted = QUOTE.exec(line)
    if (quoted) {
      closeList()
      state.markdown = true
      if (!quote) quote = []
      if (quoted[1].trim() !== '') quote.push(quoted[1].trim())
      i++
      continue
    }

    closeList()
    closeQuote()
    blocks.push(`<p>${inline(line.trim(), state, false)}</p>`)
    i++
  }
  closeList()
  closeQuote()

  return { html: blocks.join('\n'), markdown: state.markdown }
}
