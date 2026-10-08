import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import resolveConfig from 'tailwindcss/resolveConfig'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadTokens, tailwindTheme } from '../../../../scripts/gen-tokens.mjs'

// Card 1.1b guard (scripts/ui-verify/tailwind-sweep.md, section 5). Tailwind 3 emits no rule for an
// opacity on a colour it cannot parse, so `bg-[var(--accent-blue)]/15` used to do nothing at all.
// The scan reports three shapes in src/renderer: an opacity on an arbitrary var(), an opacity on a
// colour with no channel variable, and an opacity step that is not configured.

const renderer = resolve(__dirname, '..', '..')
const root = resolve(__dirname, '..', '..', '..', '..')

// Removed once card 1.3 lands. The picker popovers are rewritten in that card; until then their
// remaining arbitrary var() opacities are not checked.
const PENDING_POPOVER_FILES = ['components/task-list/RecurrencePickerPopover.tsx']

// The named colour for each variable in the sweep table (section 2). --accent-red to --accent-teal
// map by name, so only the others are listed.
const NAMED_COLOUR: Record<string, string> = {
  '--border-color': 'border',
  '--bg-primary': 'bg-page',
  '--bg-selected': 'bg-selected',
  '--bg-hover': 'bg-hover',
  '--text-primary': 'text',
  '--text-secondary': 'text-secondary',
  '--text-tertiary': 'text-tertiary',
}

const colours = tailwindTheme(loadTokens()).colors
// A colour without <alpha-value> has no channel variable and cannot take an opacity (bg-sidebar).
const rawKeys = new Set(Object.keys(colours).filter((key) => !colours[key].includes('<alpha-value>')))
// Longest keys first, so `text-secondary` wins over `text`.
const colourKeys = Object.keys(colours).sort((a, b) => b.length - a.length)
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// [variant:]* utility-colour/opacity, where the opacity is a number or an arbitrary [value].
const coloured = new RegExp(
  `(?<![\\w-])(?:[a-z-]+:)*[a-z]+(?:-[a-z]+)*?-(${colourKeys.map(escapeRe).join('|')})\\/(\\d+(?:\\.\\d+)?|\\[[^\\]]+\\])`,
  'g',
)
const arbitraryVar = /[\w:-]*\[var\(--[\w-]+\)\]\/[\w.[\]]+/g

interface Finding {
  file: string
  line: number
  cls: string
  why: string
}

/** The class with the arbitrary var() replaced by its named colour, e.g. bg-accent-blue/15. */
function suggestion(cls: string): string {
  return cls.replace(/\[var\((--[\w-]+)\)\]/, (whole, name: string) => {
    if (name.startsWith('--accent-')) return name.slice(2)
    return NAMED_COLOUR[name] ?? whole
  })
}

function scanLine(file: string, line: number, text: string, steps: Set<string>): Finding[] {
  const found: Finding[] = []
  for (const [cls] of text.matchAll(arbitraryVar)) {
    found.push({ file, line, cls, why: `an opacity on an arbitrary var() generates no CSS; use ${suggestion(cls)}` })
  }
  for (const [cls, key, alpha] of text.matchAll(coloured)) {
    if (rawKeys.has(key)) {
      found.push({ file, line, cls, why: `${key} has no channel variable, so it takes no opacity` })
    } else if (!alpha.startsWith('[') && !steps.has(alpha)) {
      found.push({ file, line, cls, why: `opacity ${alpha} is not configured (theme.extend.opacity)` })
    }
  }
  return found
}

/** Every .ts, .tsx and .html file under a folder, skipping __tests__ folders and *.test.ts. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path)
    const scanned = /\.(ts|tsx|html)$/.test(entry.name) && !entry.name.endsWith('.test.ts')
    return scanned ? [path] : []
  })
}

const posix = (path: string) => relative(renderer, path).split(sep).join('/')

describe('Tailwind colour classes in src/renderer', () => {
  let steps: Set<string>

  beforeAll(async () => {
    const { default: config } = await import(/* @vite-ignore */ pathToFileURL(resolve(root, 'tailwind.config.ts')).href)
    steps = new Set(Object.keys(resolveConfig(config).theme.opacity))
  })

  it('has no opacity on an arbitrary var(), on a raw colour or on an unconfigured step', () => {
    const findings = sourceFiles(renderer)
      .filter((path) => !PENDING_POPOVER_FILES.includes(posix(path)))
      .flatMap((path) =>
        readFileSync(path, 'utf8')
          .split('\n')
          .flatMap((text, i) => scanLine(posix(path), i + 1, text, steps)),
      )
    expect(findings.map((f) => `${f.file}:${f.line} ${f.cls}: ${f.why}`)).toEqual([])
  })

  // The probe classes are built from parts: Tailwind's content scan includes this folder, and a
  // literal class here would make it emit a rule for the probe.
  const cls = (...parts: string[]) => parts.join('-')
  const flagged = (text: string) => scanLine('probe.tsx', 1, text, steps).map((f) => f.cls)

  it('flags an opacity on an arbitrary var()', () => {
    expect(flagged(cls('bg', '[var(--accent-blue)]/15'))).toEqual(['bg-[var(--accent-blue)]/15'])
    expect(scanLine('probe.tsx', 1, cls('bg', '[var(--accent-blue)]/15'), steps)[0].why).toContain('bg-accent-blue/15')
  })

  it('flags an opacity on a colour without a channel variable', () => {
    expect(flagged(cls('bg', 'sidebar/50'))).toEqual(['bg-sidebar/50'])
  })

  it('flags an opacity step that is not configured', () => {
    expect(flagged(cls('bg', 'accent-blue/7'))).toEqual(['bg-accent-blue/7'])
  })

  it('does not flag configured steps, arbitrary steps, stock palette classes or fractions', () => {
    expect(flagged(cls('bg', 'accent-blue/8'))).toEqual([])
    expect(flagged(cls('hover:bg', 'accent-blue/90'))).toEqual([])
    expect(flagged(cls('bg', 'accent-blue/[0.3]'))).toEqual([])
    expect(flagged(cls('bg', 'red-500/5'))).toEqual([])
    expect(flagged(cls('w', '1/2'))).toEqual([])
  })
})
