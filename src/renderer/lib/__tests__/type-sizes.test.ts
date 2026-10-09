import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadTokens, typeRoles } from '../../../../scripts/gen-tokens.mjs'

// Card 1.4 guard (F-7). The type scale starts at 11 px (test-fixtures/design-tokens-v1.json, "type"),
// so no font size under 11 px may appear in src/renderer: not a Tailwind class (text-[10px],
// text-2xs), not a stylesheet font-size, not an inline React fontSize. Arbitrary text-[Npx] classes
// of 11 px or more are only allowed in the files listed below, which shrink as they move onto role
// classes (text-caption, text-chip, text-meta, text-section, text-task-title, ...).

const renderer = resolve(__dirname, '..', '..')

// Files that still use an arbitrary text-[Npx] of 11 px or more (11, 12 and 13 px have no weight in
// the role classes yet, so moving them changes the weight too). Each entry leaves the list when its
// last arbitrary size becomes a role class. A new entry needs a reason; prefer a role class.
const ARBITRARY_SIZE_ALLOWLIST = [
  'components/layout/Sidebar.tsx',
  'components/review/ProjectBranch.tsx',
  'components/settings/QuickEntrySettings.tsx',
  'components/sidebar/CustomListDragOverlay.tsx',
  'components/sidebar/CustomListNav.tsx',
  'components/sidebar/SmartListNav.tsx',
  'components/sync/SyncPanel.tsx',
  'components/task-input/AutocompleteDropdown.tsx',
  'components/task-input/TaskInputParser.tsx',
  'components/task-input/TokenChip.tsx',
  'components/task-list/NewTaskComposer.tsx',
  'components/task-list/NlpInputHighlight.tsx',
  'components/task-list/ParentDropZone.tsx',
  'components/task-list/SectionDragOverlay.tsx',
]

// Built from parts so this file does not carry literal classes into the Tailwind content scan.
const tw = (...parts: string[]) => parts.join('')
const ARBITRARY = new RegExp(tw('text-\\[(\\d+(?:\\.\\d+)?)px\\]'), 'g')
const TWO_XS = new RegExp(tw('(?<![\\w-])text-', '2xs', '(?![\\w-])'), 'g')
const CSS_SIZE = /font-size:\s*(\d+(?:\.\d+)?)px/g
const INLINE_SIZE = /fontSize:\s*(\d+(?:\.\d+)?)(?![\d.]|\s*px)/g

const MIN_PX = 11

interface Finding {
  file: string
  line: number
  text: string
  why: string
}

function scanLine(file: string, line: number, text: string, arbitraryAllowed: boolean): Finding[] {
  const found: Finding[] = []
  for (const [match, px] of text.matchAll(ARBITRARY)) {
    if (Number(px) < MIN_PX) found.push({ file, line, text: match, why: `${px}px is under ${MIN_PX}px; use a role class` })
    else if (!arbitraryAllowed) found.push({ file, line, text: match, why: 'arbitrary font size outside the allowlist; use a role class' })
  }
  for (const match of text.matchAll(TWO_XS)) {
    found.push({ file, line, text: match[0], why: `text-2xs is 10px; use text-caption or text-meta` })
  }
  for (const [match, px] of text.matchAll(CSS_SIZE)) {
    if (Number(px) < MIN_PX) found.push({ file, line, text: match, why: `${px}px is under ${MIN_PX}px; use var(--type-caption-size)` })
  }
  for (const [match, px] of text.matchAll(INLINE_SIZE)) {
    if (Number(px) < MIN_PX) found.push({ file, line, text: match, why: `${px} is under ${MIN_PX}px; use 'var(--type-caption-size)'` })
  }
  return found
}

/** Every stylesheet, script and markup file under a folder, skipping __tests__ and *.test.ts. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path)
    const scanned = /\.(ts|tsx|css|html)$/.test(entry.name) && !entry.name.endsWith('.test.ts')
    return scanned ? [path] : []
  })
}

const posix = (path: string) => relative(renderer, path).split(sep).join('/')

function scanAll(allowlist: string[]): Finding[] {
  return sourceFiles(renderer)
    .flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((text, i) => scanLine(posix(path), i + 1, text, allowlist.includes(posix(path)))),
    )
}

const show = (findings: Finding[]) => findings.map((f) => `${f.file}:${f.line} ${f.text}: ${f.why}`)

describe('Font sizes in src/renderer', () => {
  it('has no font size under 11 px', () => {
    const under = scanAll([]).filter((f) => !f.why.includes('allowlist'))
    expect(show(under)).toEqual([])
  })

  it('has arbitrary text-[Npx] classes only in the allowlisted files', () => {
    const arbitrary = scanAll(ARBITRARY_SIZE_ALLOWLIST).filter((f) => f.why.includes('allowlist'))
    expect(show(arbitrary)).toEqual([])
  })

  it('keeps every role size at 11 px or more', () => {
    const sizes = Object.values(typeRoles(loadTokens())).map((role) => (role as { size: number }).size)
    expect(sizes.length).toBeGreaterThan(0)
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(MIN_PX)
  })

  // Probes: built from parts, the same as the probes in tailwind-classes.test.ts.
  const flagged = (text: string, allowed = false) => scanLine('probe.tsx', 1, text, allowed).map((f) => f.text)

  it('flags sizes under 11 px in classes, stylesheets and inline styles', () => {
    expect(flagged(tw('text-[', '10px]'))).toEqual([tw('text-[', '10px]')])
    expect(flagged(tw('text-', '2xs'))).toEqual([tw('text-', '2xs')])
    expect(flagged(`  font-size: 10px;`)).toEqual(['font-size: 10px'])
    expect(flagged(`{ fontSize: 10, color: 'x' }`)).toEqual(['fontSize: 10'])
  })

  it('flags an arbitrary size of 11 px or more only outside the allowlist', () => {
    expect(flagged(tw('text-[', '13px]'))).toEqual([tw('text-[', '13px]')])
    expect(flagged(tw('text-[', '13px]'), true)).toEqual([])
    expect(flagged(tw('text-[', '11px]'), true)).toEqual([])
  })

  it('does not flag role classes, token variables or sizes of 11 px in stylesheets', () => {
    expect(flagged(`  font-size: var(--type-caption-size);`)).toEqual([])
    expect(flagged(`{ fontSize: 'var(--type-caption-size)' }`)).toEqual([])
    expect(flagged(`  font-size: 11px;`)).toEqual([])
  })
})
