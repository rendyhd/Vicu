#!/usr/bin/env node
// Checks site/ before it is published:
//   - every page has a language, title, description and viewport;
//   - every local link, image, script, stylesheet and icon exists, #fragments included;
//   - ids are unique and every id reference (aria-*, <use>, #links) resolves;
//   - every image has alt text and a size;
//   - nothing loads from another site (links to other sites are fine).
// Exits 1 with a list of problems.
//
//   node site/tools/check-site.mjs
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const fail = (where, msg) => problems.push(`${where}: ${msg}`)

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const pages = walk(SITE).filter((f) => f.endsWith('.html'))
const rel = (f) => relative(SITE, f).split(sep).join('/')
const isExternal = (url) => /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')
const idsOf = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])

for (const page of pages) {
  const where = rel(page)
  const html = readFileSync(page, 'utf8')
  const ids = idsOf(html)
  const idSet = new Set(ids)

  if (!/<html[^>]*\slang="[^"]+"/.test(html)) fail(where, 'no lang on <html>')
  if (!/<title>[^<]+<\/title>/.test(html)) fail(where, 'no <title>')
  if (!/<meta\s+name="description"/.test(html)) fail(where, 'no meta description')
  if (!/<meta\s+name="viewport"/.test(html)) fail(where, 'no meta viewport')

  for (const id of ids.filter((id, i) => ids.indexOf(id) !== i)) fail(where, `duplicate id "${id}"`)

  // Loads: scripts, stylesheets, images, icons. All must be local.
  for (const [match, tag, url] of html.matchAll(/<(script|img|link|source|iframe)\b[^>]*?\s(?:src|href)="([^"]+)"/g)) {
    if (tag === 'link' && /\srel="(?:canonical|alternate)"/.test(match)) continue
    if (isExternal(url)) {
      fail(where, `<${tag}> loads from another site: ${url}`)
      continue
    }
    const file = join(dirname(page), url.split(/[?#]/)[0])
    if (!existsSync(file)) fail(where, `missing file for <${tag}>: ${url}`)
  }
  for (const [, url] of html.matchAll(/<video\b[^>]*?\sposter="([^"]+)"/g)) {
    if (isExternal(url)) fail(where, `<video> poster loads from another site: ${url}`)
    else if (!existsSync(join(dirname(page), url))) fail(where, `missing video poster ${url}`)
  }
  for (const [, url] of html.matchAll(/<meta\s+property="og:image"\s+content="([^"]+)"/g)) {
    if (!isExternal(url) && !existsSync(join(dirname(page), url))) fail(where, `missing og:image ${url}`)
  }

  // Links to local pages and fragments.
  for (const [, url] of html.matchAll(/<a\b[^>]*?\shref="([^"]+)"/g)) {
    if (isExternal(url)) continue
    const [path, frag] = url.split('#')
    let target = path ? join(dirname(page), path) : page
    if (path && (path.endsWith('/') || (existsSync(target) && statSync(target).isDirectory()))) target = join(target, 'index.html')
    if (!existsSync(target)) {
      fail(where, `broken link ${url}`)
      continue
    }
    if (frag && !idsOf(readFileSync(target, 'utf8')).includes(frag)) fail(where, `missing anchor ${url}`)
  }

  // Id references.
  for (const [, attr, value] of html.matchAll(/\s(aria-controls|aria-labelledby|aria-describedby|for)="([^"]+)"/g)) {
    for (const id of value.split(/\s+/)) if (!idSet.has(id)) fail(where, `${attr} points at missing id "${id}"`)
  }
  for (const [, id] of html.matchAll(/<use\s+href="#([^"]+)"/g)) if (!idSet.has(id)) fail(where, `<use> points at missing symbol "${id}"`)

  // Images need alt text (empty for decoration) and a size.
  for (const [img] of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\salt="/.test(img)) fail(where, `image without alt: ${img.slice(0, 90)}`)
    if (!/\swidth="\d+"/.test(img) || !/\sheight="\d+"/.test(img)) fail(where, `image without width and height: ${img.slice(0, 90)}`)
  }
}

// The stylesheet and script stay local too.
for (const file of walk(SITE).filter((f) => f.endsWith('.css') || (f.endsWith('.js') && !f.includes(`${sep}tools${sep}`)))) {
  const text = readFileSync(file, 'utf8')
  if (/url\(\s*['"]?(?:https?:)?\/\//.test(text) || /@import\s+(?:url\()?['"]?https?:/.test(text)) fail(rel(file), 'loads from another site')
  if (/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon/.test(text)) fail(rel(file), 'makes a request')
}

if (problems.length) {
  console.error(problems.join('\n'))
  console.error(`\n${problems.length} problem(s)`)
  process.exit(1)
}
console.log(`site ok: ${pages.length} page(s)`)
