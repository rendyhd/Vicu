import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadTokens, radiusRoles } from '../../../../scripts/gen-tokens.mjs'

// Card 1.4b guard (F-7 shape). Corner radii come from the radius roles in
// test-fixtures/design-tokens-v1.json: rounded-control (inputs, buttons, rows), rounded-popover
// (menus and popovers), rounded-card (cards and dialogs), rounded-chip (pills). So src/renderer has
// no arbitrary rounded-[...] and no stock-scale rounded, rounded-sm, -md, -lg, -xl, -2xl, -3xl
// (side forms such as rounded-t-lg included). rounded-full stays for circles (dots, checkboxes,
// avatars) and rounded-none for resets.

const renderer = resolve(__dirname, '..', '..')

// Removed once card 1.3 lands. The picker popovers are rewritten in that card; until then their
// stock radii are not checked.
const PENDING_POPOVER_FILES = [
  'components/task-list/AttachmentPickerPopover.tsx',
  'components/task-list/DatePickerPopover.tsx',
  'components/task-list/DraftLabelPickerPopover.tsx',
  'components/task-list/InfoPopover.tsx',
  'components/task-list/LabelPickerPopover.tsx',
  'components/task-list/PriorityPickerPopover.tsx',
  'components/task-list/ProjectPickerPopover.tsx',
  'components/task-list/RecurrencePickerPopover.tsx',
  'components/task-list/ReminderPickerPopover.tsx',
]

const ROLES = new Set(Object.keys(radiusRoles(loadTokens())))
const ALLOWED = new Set([...ROLES, 'full', 'none'])

// [variant:]* rounded [-side] [-size]; the lookahead keeps `rounded-control` from matching bare.
const RADIUS = /(?<![\w-])(?:[a-z-]+:)*rounded(?:-(?:tl|tr|bl|br|ss|se|es|ee|t|b|l|r|s|e))?(?:-(\[[^\]]+\]|[\w]+))?(?![\w-])/g

interface Finding {
  file: string
  line: number
  cls: string
  why: string
}

function scanLine(file: string, line: number, text: string): Finding[] {
  // Prose in a comment ("rounded corners") is not a class.
  if (/^\s*(\/\/|\*|\/\*)/.test(text)) return []
  const found: Finding[] = []
  for (const [cls, size] of text.matchAll(RADIUS)) {
    if (size === undefined) found.push({ file, line, cls, why: 'a bare rounded is the stock 4 px; use a radius role' })
    else if (size.startsWith('[')) found.push({ file, line, cls, why: 'an arbitrary radius; use a radius role' })
    else if (!ALLOWED.has(size)) found.push({ file, line, cls, why: `${size} is not a radius role (${[...ROLES].join(', ')})` })
  }
  return found
}

/** Every .ts, .tsx and .html file under a folder, skipping __tests__ folders and *.test.ts. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path)
    return /\.(ts|tsx|html)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

const posix = (path: string) => relative(renderer, path).split(sep).join('/')

describe('radius roles in src/renderer', () => {
  it('defines the four roles the classes map onto', () => {
    expect([...ROLES].sort()).toEqual(['card', 'chip', 'control', 'popover'])
  })

  it('has no arbitrary or stock-scale rounded class', () => {
    const findings = sourceFiles(renderer)
      .filter((path) => !PENDING_POPOVER_FILES.includes(posix(path)))
      .flatMap((path) =>
        readFileSync(path, 'utf8')
          .split('\n')
          .flatMap((text, i) => scanLine(posix(path), i + 1, text)),
      )
    expect(findings.map((f) => `${f.file}:${f.line} ${f.cls}: ${f.why}`)).toEqual([])
  })

  it('lists only files that exist', () => {
    const all = new Set(sourceFiles(renderer).map(posix))
    expect(PENDING_POPOVER_FILES.filter((file) => !all.has(file))).toEqual([])
  })

  // The probe classes are built from parts: Tailwind's content scan includes this folder, and a
  // literal class here would make it emit a rule for the probe.
  const cls = (...parts: string[]) => parts.join('-')
  const flagged = (text: string) => scanLine('probe.tsx', 1, text).map((f) => f.cls)

  it('flags a bare rounded, a stock size and an arbitrary radius', () => {
    expect(flagged(`className="flex ${cls('rounded')} p-1"`)).toEqual(['rounded'])
    expect(flagged(cls('rounded', 'md'))).toEqual(['rounded-md'])
    expect(flagged(cls('hover:rounded', 'xl'))).toEqual(['hover:rounded-xl'])
    expect(flagged(cls('rounded', 't', 'lg'))).toEqual(['rounded-t-lg'])
    expect(flagged(cls('rounded', '[10px]'))).toEqual(['rounded-[10px]'])
  })

  it('flags a name that is not a role', () => {
    expect(flagged(cls('rounded', 'pill'))).toEqual(['rounded-pill'])
  })

  it('does not flag roles, circles, resets, other utilities or comments', () => {
    expect(flagged(cls('rounded', 'control'))).toEqual([])
    expect(flagged(cls('rounded', 'popover'))).toEqual([])
    expect(flagged(cls('rounded', 'card'))).toEqual([])
    expect(flagged(cls('rounded', 'chip'))).toEqual([])
    expect(flagged(cls('rounded', 't', 'popover'))).toEqual([])
    expect(flagged(cls('rounded', 'full'))).toEqual([])
    expect(flagged(cls('rounded', 'none'))).toEqual([])
    expect(flagged(cls('border', 'rounded'))).toEqual([])
    expect(flagged('// keep the window height so rounded corners stay visible')).toEqual([])
  })
})
