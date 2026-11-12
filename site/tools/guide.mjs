#!/usr/bin/env node
// Builds the user guide: docs/guide/**/*.md -> site/guide/**/index.html, plus the search index
// (site/assets/js/guide-index.js). The output is committed, so the site keeps having no build step;
// run this after changing a guide page, then `npm run site:check`.
//
//   node site/tools/guide.mjs          write the pages
//   node site/tools/guide.mjs --check  exit 1 when a page is out of date
//
// Pages are a small Markdown dialect (no dependencies):
//   ---                                front matter: title, description, lead (one paragraph)
//   # / ## / ###                       headings (## and ### get ids and go into "On this page")
//   paragraphs, - lists, 1. lists (two-space indent nests), | tables |, ``` code ```
//   > [!NOTE] / [!TIP] / [!PRO] / [!WARNING] / [!PHONE] / [!DESKTOP]   callouts
//   **bold**, *italic*, `code`, [text](link), <kbd>…</kbd> and other inline HTML pass through
//   {desktop} {android} {ios} {phone} {all} {pro}                      platform badges
//   ![alt](../assets/img/screens/x.webp "caption")                    image; size read from the file
//   :::cards ... :::                    a grid of "- [Title](link): text" items
//   :::steps ... :::                    a numbered list drawn as steps
// Links between guide pages use the page's slug: [Today](guide:lists#today).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = join(SITE, '..')
const SRC = join(ROOT, 'docs', 'guide')
const OUT = join(SITE, 'guide')
const CHECK = process.argv.includes('--check')
const EDIT_BASE = 'https://github.com/rendyhd/Vicu/blob/main/docs/guide/'

// The guide's order. Slugs are paths under guide/ ('' is the guide's home).
const NAV = [
  { title: 'Start here', pages: ['', 'getting-started', 'basics'] },
  { title: 'Everyday Vicu', pages: ['capture', 'tasks', 'lists', 'projects', 'custom-lists', 'plan', 'calendars', 'routines', 'review', 'collaboration', 'assistant'] },
  { title: 'Your devices', pages: ['desktop', 'phone', 'sync', 'settings'] },
  { title: 'Vicu Pro', pages: ['pro', 'pro/available', 'pro/promises', 'pro/portfolio', 'pro/power'] },
  { title: 'Reference', pages: ['quick-add', 'shortcuts', 'faq', 'glossary'] },
]

// --- Markdown -----------------------------------------------------------------------------------

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Platform badges ({desktop} ...) are not part of a heading's id or of its "On this page" entry.
const BADGE_TOKENS = /\s*\{(?:desktop|android|ios|phone|all|pro)\}/g
const slugify = (text) =>
  text
    .replace(BADGE_TOKENS, '')
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

const BADGES = {
  desktop: ['Desktop', 'i-monitor'],
  android: ['Android', 'i-android'],
  ios: ['iPhone and iPad', 'i-apple'],
  phone: ['Phone', 'i-phone'],
  all: ['All devices', 'i-grid'],
  pro: ['Pro', 'i-sparkle'],
}

function badge(key) {
  const [label, icon] = BADGES[key]
  return `<span class="g-badge g-badge--${key}"><svg aria-hidden="true"><use href="#${icon}" /></svg>${label}</span>`
}

/** Inline Markdown. `depth` is how many folders the page is below guide/, for guide: links. */
function inline(text, ctx) {
  const codes = []
  let s = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${esc(c)}</code>`)
    return `\u0000${codes.length - 1}\u0000`
  })
  // Keep inline HTML (kbd, br, span) as written; escape a lone & or < that is not a tag.
  s = s.replace(/&(?![a-z]+;|#\d+;)/g, '&amp;').replace(/<(?![a-z/!])/g, '&lt;')
  s = s.replace(/\{(desktop|android|ios|phone|all|pro)\}/g, (_, k) => badge(k))
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, src, cap) => image(alt, src, cap, ctx))
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${esc(link(href, ctx))}">${label}</a>`)
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)])
}

function link(href, ctx) {
  if (!href.startsWith('guide:')) return href
  const [slug, frag] = href.slice(6).split('#')
  if (!PAGES.has(slug)) ctx.problems.push(`${ctx.slug}: link to unknown page "${slug}"`)
  else if (frag && !PAGES.get(slug).ids.has(frag)) ctx.problems.push(`${ctx.slug}: link to missing anchor "${slug}#${frag}"`)
  return pageUrl(slug, ctx.slug) + (frag ? `#${frag}` : '')
}

/** A relative URL from one guide page to another. */
function pageUrl(to, from) {
  const fromDir = from === '' ? [] : from.split('/')
  const up = '../'.repeat(fromDir.length)
  return `${up}${to === '' ? '' : `${to}/`}` || './'
}

function webpSize(file) {
  const b = readFileSync(file)
  const kind = b.toString('ascii', 12, 16)
  if (kind === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)]
  if (kind === 'VP8L') {
    const bits = b.readUInt32LE(21)
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)]
  }
  if (kind === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]
  throw new Error(`unknown webp ${file}`)
}

function image(alt, srcIn, caption, ctx) {
  // screen:<name> is a file in assets/img/screens, whatever the page's depth.
  const depth = ctx.slug === '' ? 0 : ctx.slug.split('/').length
  const src = srcIn.startsWith('screen:') ? `${'../'.repeat(depth + 1)}assets/img/screens/${srcIn.slice(7)}` : srcIn
  const here = (s) => join(OUT, ...ctx.slug.split('/').filter(Boolean), s)
  const file = here(src)
  if (!existsSync(file)) {
    ctx.problems.push(`${ctx.slug}: missing image ${srcIn}`)
    return ''
  }
  const [w, h] = src.endsWith('.webp') ? webpSize(file) : [0, 0]
  // A dark twin (name-dark.webp, or name-light -> name-dark) is shown in the dark theme.
  const dark = /-light\.webp$/.test(src) ? src.replace(/-light\.webp$/, '-dark.webp') : src.replace(/\.webp$/, '-dark.webp')
  const hasDark = dark !== src && existsSync(here(dark))
  const img = (s, cls) => `<img${cls ? ` class="${cls}"` : ''} src="${esc(s)}" alt="${esc(alt)}" width="${w}" height="${h}" loading="lazy" />`
  const pics = hasDark ? img(src, 'only-light') + img(dark, 'only-dark') : img(src, '')
  return `<span class="g-figure${h > w ? ' g-figure--tall' : ''}">${pics}${caption ? `<span class="g-caption">${inline(caption, ctx)}</span>` : ''}</span>`
}

function table(lines, ctx) {
  const rows = lines.map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
  const [head, , ...body] = rows
  return `<div class="g-table"><table><thead><tr>${head.map((c) => `<th scope="col">${inline(c, ctx)}</th>`).join('')}</tr></thead><tbody>${body
    .map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${inline(c, ctx)}</th>` : `<td>${inline(c, ctx)}</td>`)).join('')}</tr>`)
    .join('')}</tbody></table></div>`
}

/** A list block (lines starting with - or 1.), nested by two spaces. */
function list(lines, ctx) {
  let html = ''
  const stack = []
  // Join wrapped lines onto their item first, so bold or a link may span the wrap.
  const ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/
  const items = []
  for (const raw of lines) {
    if (ITEM.test(raw) || !items.length) items.push(raw)
    else items[items.length - 1] += ` ${raw.trim()}`
  }
  for (const raw of items) {
    const m = raw.match(ITEM)
    if (!m) {
      html += inline(raw.trim(), ctx)
      continue
    }
    const depth = Math.floor(m[1].length / 2)
    const tag = /\d/.test(m[2]) ? 'ol' : 'ul'
    while (stack.length > depth + 1) html += `</${stack.pop()}></li>`
    if (stack.length === depth + 1 && stack[depth] !== tag) html += `</${stack.pop()}>`
    if (stack.length < depth + 1) {
      if (stack.length) html = html.replace(/<\/li>$/, '')
      html += `<${tag}>`
      stack.push(tag)
    }
    html += `<li>${inline(m[3], ctx)}</li>`
  }
  while (stack.length) {
    html += `</${stack.pop()}>`
    if (stack.length) html += '</li>'
  }
  return html
}

const CALLOUTS = { NOTE: 'Note', TIP: 'Tip', PRO: 'Pro', WARNING: 'Careful', PHONE: 'On the phone', DESKTOP: 'On the desktop' }

function blocks(md, ctx) {
  const lines = md.split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    if (line.startsWith('```')) {
      const body = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++])
      i++
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`)
      continue
    }
    if (line.startsWith(':::')) {
      const kind = line.slice(3).trim()
      const body = []
      i++
      while (i < lines.length && !lines[i].startsWith(':::')) body.push(lines[i++])
      i++
      if (kind === 'cards') {
        const items = body.filter((l) => l.trim()).map((l) => {
          const m = l.match(/^-\s+\[([^\]]+)\]\(([^)]+)\)(?::\s*(.*))?$/)
          if (!m) return ''
          return `<li><a class="g-card" href="${esc(link(m[2], ctx))}"><strong>${inline(m[1], ctx)}</strong>${m[3] ? `<span>${inline(m[3], ctx)}</span>` : ''}</a></li>`
        })
        out.push(`<ul class="g-cards">${items.join('')}</ul>`)
      } else if (kind === 'steps') {
        out.push(`<div class="g-steps">${list(body.filter((l) => l.trim()), ctx)}</div>`)
      }
      continue
    }
    const h = line.match(/^(#{2,4})\s+(.*)$/)
    if (h) {
      const level = h[1].length
      const text = h[2].trim()
      const id = ctx.uniqueId(slugify(text))
      if (level <= 3) ctx.toc.push({ level, id, text: inline(text.replace(BADGE_TOKENS, ''), ctx).replace(/<[^>]+>/g, '') })
      ctx.text.push(text)
      out.push(`<h${level} id="${id}"><a class="g-anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${inline(text, ctx)}</h${level}>`)
      i++
      continue
    }
    if (line.startsWith('>')) {
      const body = []
      while (i < lines.length && lines[i].startsWith('>')) body.push(lines[i++].replace(/^>\s?/, ''))
      const m = body[0].match(/^\[!(\w+)\]\s*(.*)$/)
      const kind = m && CALLOUTS[m[1]] ? m[1] : 'NOTE'
      if (m) body[0] = m[2]
      ctx.text.push(body.join(' '))
      out.push(`<aside class="g-callout g-callout--${kind.toLowerCase()}"><p class="g-callout-title">${CALLOUTS[kind]}</p>${blocks(body.join('\n'), ctx)}</aside>`)
      continue
    }
    if (line.trim().startsWith('|')) {
      const body = []
      while (i < lines.length && lines[i].trim().startsWith('|')) body.push(lines[i++])
      ctx.text.push(body.join(' '))
      out.push(table(body, ctx))
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const body = []
      while (i < lines.length && lines[i].trim() && (/^\s*([-*]|\d+\.)\s+/.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) body.push(lines[i++])
      ctx.text.push(body.join(' '))
      out.push(list(body, ctx))
      continue
    }
    const para = []
    while (i < lines.length && lines[i].trim() && !/^(#{2,4}\s|```|:::|>|\s*\||\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++].trim())
    ctx.text.push(para.join(' '))
    const html = inline(para.join(' '), ctx)
    out.push(/^<span class="g-figure/.test(html) ? html.replace(/^<span class="g-figure([^"]*)"/, '<figure class="g-figure$1"').replace(/<\/span>$/, '</figure>').replace(/<span class="g-caption">(.*)<\/span><\/figure>$/, '<figcaption>$1</figcaption></figure>') : `<p>${html}</p>`)
  }
  return out.join('\n')
}

// --- Pages ---------------------------------------------------------------------------------------

function readPage(slug) {
  const file = join(SRC, slug === '' ? 'index.md' : `${slug}.md`)
  if (!existsSync(file)) throw new Error(`no page for "${slug}": ${relative(ROOT, file)}`)
  const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n/)
  if (!fm) throw new Error(`${slug}: no front matter`)
  const meta = Object.fromEntries(fm[1].split('\n').filter(Boolean).map((l) => {
    const at = l.indexOf(':')
    return [l.slice(0, at).trim(), l.slice(at + 1).trim()]
  }))
  for (const key of ['title', 'description']) if (!meta[key]) throw new Error(`${slug}: no ${key}`)
  const body = raw.slice(fm[0].length)
  // Ids first, so links can check anchors on any page.
  const ids = new Set([...body.matchAll(/^#{2,4}\s+(.*)$/gm)].map((m) => slugify(m[1])))
  return { slug, meta, body, ids, file }
}

const ORDER = NAV.flatMap((section) => section.pages.map((slug) => ({ slug, section: section.title })))
const PAGES = new Map(ORDER.map(({ slug }) => [slug, readPage(slug)]))

const SPRITE = (() => {
  const html = readFileSync(join(SITE, 'index.html'), 'utf8')
  return html.match(/<svg class="sprite"[\s\S]*?<\/svg>/)[0]
})()

function sidebar(current) {
  return NAV.map((section) => {
    const open = section.pages.includes(current)
    const items = section.pages
      .map((slug) => {
        const page = PAGES.get(slug)
        const here = slug === current
        return `<li><a href="${pageUrl(slug, current)}"${here ? ' aria-current="page"' : ''}>${esc(page.meta.nav ?? page.meta.title)}</a></li>`
      })
      .join('')
    return `<details class="g-nav-section"${open ? ' open' : ''}><summary>${esc(section.title)}</summary><ul>${items}</ul></details>`
  }).join('')
}

function render({ slug, meta, body }, problems) {
  const toc = []
  const used = new Set()
  const ctx = {
    slug,
    toc,
    text: [],
    problems,
    uniqueId: (id) => {
      let unique = id || 'section'
      for (let n = 2; used.has(unique); n++) unique = `${id}-${n}`
      used.add(unique)
      return unique
    },
  }
  const content = blocks(body, ctx)
  const index = ORDER.findIndex((p) => p.slug === slug)
  const prev = ORDER[index - 1]
  const next = ORDER[index + 1]
  const depth = slug === '' ? 0 : slug.split('/').length
  const up = '../'.repeat(depth + 1)
  const section = ORDER[index].section
  const canonical = `https://vicutodo.app/guide/${slug === '' ? '' : `${slug}/`}`
  const title = slug === '' ? 'Vicu guide' : `${meta.title} · Vicu guide`
  const pager = [
    prev ? `<a class="g-pager-prev" href="${pageUrl(prev.slug, slug)}"><span>Previous</span>${esc(PAGES.get(prev.slug).meta.title)}</a>` : '<span></span>',
    next ? `<a class="g-pager-next" href="${pageUrl(next.slug, slug)}"><span>Next</span>${esc(PAGES.get(next.slug).meta.title)}</a>` : '<span></span>',
  ].join('')
  const onPage = toc.filter((t) => t.level === 2)
  const html = `<!doctype html>
<html lang="en" class="no-js">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(meta.description)}" />
    <meta name="color-scheme" content="light dark" />
    <meta name="theme-color" content="#fbfaf8" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#111113" media="(prefers-color-scheme: dark)" />
    <link rel="icon" href="${up}assets/img/brand/vicu-32.png" sizes="32x32" type="image/png" />
    <link rel="apple-touch-icon" href="${up}assets/img/brand/vicu-180.png" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Vicu" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(meta.description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="https://vicutodo.app/assets/img/og.jpg" />
    <link rel="canonical" href="${canonical}" />
    <link rel="stylesheet" href="${up}assets/css/site.css" />
    <script>
      (function () {
        var d = document.documentElement;
        d.className = d.className.replace('no-js', 'js');
        try {
          var t = localStorage.getItem('vicu-site-theme');
          if (t === 'light' || t === 'dark') d.setAttribute('data-theme', t);
        } catch (e) {}
      })();
    </script>
    <script src="${up}assets/js/site.js" defer></script>
    <script src="${up}assets/js/guide-index.js" defer></script>
    <script src="${up}assets/js/guide.js" defer></script>
  </head>
  <body class="g-body" data-guide-root="${pageUrl('', slug)}">
    ${SPRITE}

    <a class="skip-link" href="#main">Skip to content</a>

    <header class="site-header">
      <div class="wrap header-row">
        <a class="brand" href="${up}">
          <img src="${up}assets/img/brand/vicu-64.png" alt="" width="32" height="32" />
          <span>Vicu</span>
        </a>
        <nav class="nav" aria-label="Site">
          <a href="${up}">Home</a>
          <a href="${pageUrl('', slug)}"${slug === '' ? ' aria-current="page"' : ''}>Guide</a>
          <a href="${pageUrl('pro', slug)}">Vicu Pro</a>
          <a href="${up}#download">Download</a>
        </nav>
        <div class="header-actions">
          <button class="icon-btn g-menu-toggle" type="button" aria-controls="g-sidebar" aria-expanded="false" aria-label="Guide contents">
            <svg aria-hidden="true"><use href="#i-sections" /></svg>
          </button>
          <button class="icon-btn theme-toggle" type="button" aria-label="Switch between light and dark">
            <svg class="icon-moon" aria-hidden="true"><use href="#i-moon" /></svg>
            <svg class="icon-sun" aria-hidden="true"><use href="#i-sun" /></svg>
          </button>
        </div>
      </div>
    </header>

    <div class="wrap g-layout">
      <aside class="g-sidebar" id="g-sidebar" aria-label="Guide contents">
        <form class="g-search" role="search" onsubmit="return false">
          <label class="visually-hidden" for="g-search-input">Search the guide</label>
          <svg aria-hidden="true"><use href="#i-search" /></svg>
          <input id="g-search-input" type="search" placeholder="Search the guide" autocomplete="off" aria-describedby="g-search-hint" />
          <span id="g-search-hint" class="visually-hidden">Results show below as you type.</span>
        </form>
        <ul class="g-search-results" id="g-search-results" aria-live="polite" hidden></ul>
        <nav class="g-nav" aria-label="Guide pages">${sidebar(slug)}</nav>
      </aside>

      <main id="main" class="g-main">
        <article class="g-article">
          <nav class="g-crumbs" aria-label="Breadcrumb"><a href="${pageUrl('', slug)}">Guide</a>${slug === '' ? '' : ` <span aria-hidden="true">/</span> <span>${esc(section)}</span>`}</nav>
          <h1 class="g-title">${esc(meta.title)}</h1>
          ${meta.lead ? `<p class="g-lead">${inline(meta.lead, ctx)}</p>` : ''}
          ${onPage.length > 2 ? `<details class="g-toc-inline"><summary>On this page</summary><ul>${onPage.map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join('')}</ul></details>` : ''}
          <div class="g-content">
${content}
          </div>
          <nav class="g-pager" aria-label="Previous and next page">${pager}</nav>
          <p class="g-edit"><a href="${EDIT_BASE}${slug === '' ? 'index' : slug}.md">Suggest a change to this page</a></p>
        </article>
        ${onPage.length > 2 ? `<nav class="g-toc" aria-label="On this page"><p>On this page</p><ul>${toc.map((t) => `<li class="g-toc-${t.level}"><a href="#${t.id}">${esc(t.text)}</a></li>`).join('')}</ul></nav>` : ''}
      </main>
    </div>

    <footer class="site-footer">
      <div class="wrap footer-row">
        <a class="brand" href="${up}"><img src="${up}assets/img/brand/vicu-64.png" alt="" width="28" height="28" /><span>Vicu</span></a>
        <nav class="footer-links" aria-label="Footer">
          <a href="https://github.com/rendyhd/Vicu">Desktop on GitHub</a>
          <a href="https://github.com/rendyhd/Vicu-Mobile">Mobile on GitHub</a>
          <a href="https://github.com/rendyhd/Vicu/releases">Release notes</a>
          <a href="https://github.com/rendyhd/Vicu-Mobile/blob/main/docs/privacy-policy.md">Privacy</a>
          <a href="https://ko-fi.com/rendyhd">Support on Ko-fi</a>
        </nav>
        <p>MIT licensed. Vicu is an independent app, not made by the Vikunja team. Screens show made-up tasks.</p>
      </div>
    </footer>
  </body>
</html>
`
  return { html, toc, text: ctx.text.join(' ') }
}

// --- Write ---------------------------------------------------------------------------------------

const problems = []
const outputs = new Map()
const index = []
for (const { slug } of ORDER) {
  const page = PAGES.get(slug)
  const { html, toc, text } = render(page, problems)
  outputs.set(join(OUT, ...slug.split('/').filter(Boolean), 'index.html'), html)
  const plain = text.replace(/<[^>]+>/g, ' ').replace(/[*`#>|\[\]()]/g, ' ').replace(/\{[a-z]+\}/g, ' ').replace(/\s+/g, ' ').trim()
  index.push({ s: slug, t: page.meta.title, d: page.meta.description, h: toc.map((t) => [t.id, t.text]), x: plain })
}
outputs.set(
  join(SITE, 'assets', 'js', 'guide-index.js'),
  `// Generated by site/tools/guide.mjs: the guide's pages for the search box. Do not edit.\nwindow.VICU_GUIDE = ${JSON.stringify(index)};\n`,
)

// Every page source must be in NAV.
const listed = new Set(ORDER.map((p) => p.slug))
const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]))
for (const file of walk(SRC).filter((f) => f.endsWith('.md'))) {
  const slug = relative(SRC, file).split(sep).join('/').replace(/\.md$/, '').replace(/^index$/, '')
  if (!listed.has(slug)) problems.push(`${relative(ROOT, file)} is not in NAV`)
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}

let stale = 0
for (const [file, html] of outputs) {
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null
  if (current === html) continue
  stale++
  if (CHECK) {
    console.error(`out of date: ${relative(ROOT, file)}`)
    continue
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, html)
}
if (CHECK && stale) process.exit(1)
// Remove pages whose source is gone.
if (!CHECK && existsSync(OUT)) {
  for (const file of walk(OUT).filter((f) => f.endsWith('index.html'))) {
    if (!outputs.has(file)) rmSync(dirname(file) === OUT ? file : dirname(file), { recursive: true, force: true })
  }
}
console.log(CHECK ? `guide ok: ${outputs.size - 1} page(s)` : `guide: ${outputs.size - 1} page(s), ${stale} written`)
