// WCAG contrast of colour pairs.
//
//   node scripts/ui-verify/tools/contrast.mjs "#9A4600" "#FAF8FE" [minimum]
//   node scripts/ui-verify/tools/contrast.mjs --file pairs.json
//
// pairs.json is a list of [label, foreground, background, minimum]. A background may be written
// "mix(#d70015,#ffffff,8)": 8 percent of the first colour over the second (a tinted chip).
// Exit code 1 when a pair is below its minimum. Also exports ratio() and mix() for other scripts.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const hex = (h) => h.replace('#', '').match(/../g).map((x) => parseInt(x, 16))
const lin = (c) => {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = (h) => {
  const [r, g, b] = hex(h)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (hi + 0.05) / (lo + 0.05)
}

/** `percent` percent of `a` over `b`, as #rrggbb. */
export function mix(a, b, percent) {
  return '#' + hex(a).map((v, i) => Math.round((v * percent + hex(b)[i] * (100 - percent)) / 100).toString(16).padStart(2, '0')).join('')
}

function resolveColour(value) {
  const m = /^mix\(\s*(#[0-9a-fA-F]{6})\s*,\s*(#[0-9a-fA-F]{6})\s*,\s*(\d+(?:\.\d+)?)\s*\)$/.exec(value)
  return m ? mix(m[1], m[2], Number(m[3])) : value
}

export function check(rows) {
  let bad = 0
  for (const [label, fg, bgRaw, min = 4.5] of rows) {
    const bg = resolveColour(bgRaw)
    const r = ratio(fg, bg)
    if (r < min) bad++
    console.log(`${r < min ? 'FAIL' : 'ok  '} ${r.toFixed(2).padStart(5)}  ${label} (${fg} on ${bg}, needs ${min})`)
  }
  console.log(bad ? `${bad} below minimum` : 'all pass')
  return bad
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2)
  if (args[0] === '--file') {
    process.exit(check(JSON.parse(readFileSync(args[1], 'utf8'))) ? 1 : 0)
  } else if (args.length >= 2) {
    process.exit(check([[`${args[0]} on ${args[1]}`, args[0], args[1], Number(args[2] ?? 4.5)]]) ? 1 : 0)
  } else {
    console.error('usage: contrast.mjs <foreground> <background> [minimum]  |  contrast.mjs --file pairs.json')
    process.exit(2)
  }
}
