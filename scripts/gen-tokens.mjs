// Generates the desktop design tokens from test-fixtures/design-tokens-v1.json.
//
//   node scripts/gen-tokens.mjs            write src/renderer/assets/tokens.css
//   node scripts/gen-tokens.mjs --check    exit 1 when tokens.css differs from a fresh generation
//
// The same module feeds tailwind.config.ts (tailwindTheme) and the tests (tokens.test.ts,
// contrast.test.ts), so the CSS variables, the Tailwind classes and the assertions all come from
// the one fixture. The fixture is the contract (docs/design-system-v1.md); this file only
// translates it. Nothing here imports Electron or the DOM.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))
export const FIXTURE_PATH = resolve(here, '..', 'test-fixtures', 'design-tokens-v1.json')
export const OUTPUT_PATH = resolve(here, '..', 'src', 'renderer', 'assets', 'tokens.css')

/** Intervals of a generated spring curve; the curve has one more point than this. */
const SPRING_INTERVALS = 48

export function loadTokens(path = FIXTURE_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

// --- colour roles ---------------------------------------------------------------------------

/** CSS variable of a role: its alias from the fixture, else two dashes plus the role with dashes. */
export function cssVar(tokens, role) {
  return tokens.css.aliases[role] ?? `--${role.replaceAll('.', '-')}`
}

/** Roles that keep a raw var() colour: no channel variable, no opacity classes. */
export function isRawRole(tokens, role) {
  return tokens.css.rawVar.includes(role)
}

/** "#0A66D1" as the space separated channels CSS rgb() takes: "10 102 209". */
export function channels(hex) {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex)
  if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`)
  return [m[1], m[2], m[3]].map((h) => parseInt(h, 16)).join(' ')
}

// --- springs (ported from scripts/ui-verify/tools/springs.mjs) -------------------------------

/** Position of a unit-mass spring (damping ratio z, stiffness k) at time t seconds, from 0 to 1. */
export function springPosition(z, k, t) {
  const w0 = Math.sqrt(k)
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z)
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t))
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t)
}

/** A CSS linear() easing of the spring over the CSS duration; the last point is exactly 1. */
export function springCurve({ damping, stiffness }, ms, intervals = SPRING_INTERVALS) {
  const points = []
  for (let i = 0; i <= intervals; i++) {
    points.push(+springPosition(damping, stiffness, (ms / 1000) * (i / intervals)).toFixed(3))
  }
  points[0] = 0
  points[intervals] = 1
  return `linear(${points.join(', ')})`
}

// --- type, radius, motion ---------------------------------------------------------------------

const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

/** Type roles that have a desktop size: { 'page-title': { size: 26, weight: 700, line?: 20 } }. */
export function typeRoles(tokens) {
  const out = {}
  for (const [name, value] of Object.entries(tokens.type)) {
    if (name === 'about' || typeof value !== 'object' || typeof value.px !== 'number') continue
    out[kebab(name)] = { size: value.px, weight: value.weight, ...(value.lineHeightPx ? { line: value.lineHeightPx } : {}) }
  }
  return out
}

/** Radius roles that exist on desktop, as CSS lengths: { control: '6px', chip: '9999px' }. */
export function radiusRoles(tokens) {
  const out = {}
  for (const [name, value] of Object.entries(tokens.radius)) {
    if (name === 'about') continue
    if (value === 'full') out[name] = '9999px'
    else if (value && typeof value.px === 'number') out[name] = `${value.px}px`
  }
  return out
}

/** Motion variables in output order: [name, value]. */
export function motionVars(tokens) {
  const m = tokens.motion
  const vars = [
    ['--dur-fade-fast', `${m.fade.fast.ms}ms`],
    ['--ease-standard', m.fade.fast.easing],
    ['--dur-fade-base', `${m.fade.base.ms}ms`],
    ['--ease-enter', m.fade.base.enter],
    ['--ease-exit', m.fade.base.exit],
  ]
  for (const [name, token] of [['move', m.move], ['move-expressive', m.moveExpressive], ['pop', m.pop]]) {
    vars.push([`--dur-${name}`, `${token.ms}ms`], [`--spring-${name}`, springCurve(token.spring, token.ms)])
  }
  vars.push(
    ['--dur-page-out', `${m.page.outMs}ms`],
    ['--dur-page-in', `${m.page.inMs}ms`],
    ['--page-rise', `${m.page.risePx}px`],
    ['--stagger', `${m.stagger.ms}ms`],
    ['--stagger-max', String(m.stagger.maxItems)],
    ['--dur-keyboard-move-max', `${m.keyboardMoveMaxMs}ms`],
    ['--dur-check-draw', `${m.checkDrawMs}ms`],
    ['--dur-strike-draw', `${m.strikeDrawMs}ms`],
  )
  return vars
}

// --- tokens.css -------------------------------------------------------------------------------

function colourLines(tokens, theme) {
  const lines = []
  for (const [role, def] of Object.entries(tokens.roles)) {
    const name = cssVar(tokens, role)
    lines.push(`  ${name}: ${def[theme]};`)
    if (!isRawRole(tokens, role)) lines.push(`  ${name}-rgb: ${channels(def[theme])};`)
  }
  return lines
}

/** The full text of tokens.css (LF line endings, trailing newline). */
export function generateTokensCss(tokens) {
  const root = [...colourLines(tokens, 'light')]
  root.push('')
  for (const [name, t] of Object.entries(typeRoles(tokens))) {
    root.push(`  --type-${name}-size: ${t.size}px;`, `  --type-${name}-weight: ${t.weight};`)
    if (t.line) root.push(`  --type-${name}-line: ${t.line}px;`)
  }
  root.push('')
  for (const [name, value] of Object.entries(radiusRoles(tokens))) root.push(`  --radius-${name}: ${value};`)
  root.push('')
  for (const [name, value] of motionVars(tokens)) root.push(`  ${name}: ${value};`)

  return [
    '/*',
    ' * Generated by scripts/gen-tokens.mjs from test-fixtures/design-tokens-v1.json. Do not edit.',
    ' * Change the fixture (in both repos), then run: npm run tokens',
    ' *',
    ' * Every colour role has a hex variable and an -rgb channel variable (Tailwind builds its',
    ' * opacity classes from the channels). bg.sidebar has no channel variable: it keeps a raw',
    ' * var() so the macOS vibrancy override and the Windows Mica rule can replace it.',
    ' */',
    ':root {',
    ...root,
    '}',
    '',
    '.dark {',
    ...colourLines(tokens, 'dark'),
    '}',
    '',
  ].join('\n')
}

// --- Tailwind ---------------------------------------------------------------------------------

/** Opacity steps the contract needs on top of Tailwind's scale: the tint alphas, e.g. 8 and 12. */
export function tintOpacities(tokens) {
  const alphas = new Set([tokens.labelChip.tintAlpha])
  for (const rule of tokens.contrast.rules) {
    for (const bg of rule.bg) if (typeof bg === 'object' && bg.tint) alphas.add(bg.alpha)
  }
  const out = {}
  for (const alpha of [...alphas].sort((a, b) => a - b)) out[String(Math.round(alpha * 100))] = String(alpha)
  return out
}

/**
 * The parts of the Tailwind theme that come from the fixture.
 *
 * Colour class names: a role's name with dots turned into dashes, so `bg.page` is `bg-bg-page`,
 * `text.secondary` is `text-text-secondary`, `border` is `border-border`, `status.overdue` is
 * `text-status-overdue`. The exception is the raw bg.sidebar, which stays `bg-sidebar`. The legacy
 * palette names `accent-blue` ... `accent-teal` stay (they point at the same variables).
 */
export function tailwindTheme(tokens) {
  const colors = {}
  for (const role of Object.keys(tokens.roles)) {
    const name = cssVar(tokens, role)
    if (isRawRole(tokens, role)) {
      colors[role.replace(/^bg\./, '')] = `var(${name})`
      continue
    }
    const value = `rgb(var(${name}-rgb) / <alpha-value>)`
    colors[role.replaceAll('.', '-')] = value
    if (tokens.css.aliases[role]?.startsWith('--accent-')) colors[name.slice(2)] = value
  }

  const fontSize = {}
  for (const [name, t] of Object.entries(typeRoles(tokens))) {
    fontSize[name] = [
      `var(--type-${name}-size)`,
      { fontWeight: `var(--type-${name}-weight)`, ...(t.line ? { lineHeight: `var(--type-${name}-line)` } : {}) },
    ]
  }

  const borderRadius = {}
  for (const name of Object.keys(radiusRoles(tokens))) borderRadius[name] = `var(--radius-${name})`

  return { colors, fontSize, borderRadius, opacity: tintOpacities(tokens) }
}

// --- command line -----------------------------------------------------------------------------

function main(args) {
  const css = generateTokensCss(loadTokens())
  if (args.includes('--check')) {
    const current = existsSync(OUTPUT_PATH) ? readFileSync(OUTPUT_PATH, 'utf8') : ''
    if (current !== css) {
      console.error('tokens.css is out of date: run npm run tokens')
      process.exit(1)
    }
    console.log('tokens.css is up to date')
    return
  }
  writeFileSync(OUTPUT_PATH, css)
  console.log(`wrote ${OUTPUT_PATH}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
