import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// Card 1.4b guard (F-8). text.tertiary is for disabled controls and decoration only
// (docs/design-system-v1.md section 1); readable text uses text.secondary. This scan reports a
// tertiary *text colour* in src/renderer: a text-text-tertiary or text-[var(--text-tertiary)]
// class, or a `color: 'var(--text-tertiary)'` style. Borders and fills in the same colour are not
// text and are not reported.

const renderer = resolve(__dirname, '..', '..')

// Decorative uses, one entry per file with the reason. A new entry needs a reason; prefer
// text.secondary.
const DECORATIVE_ALLOWLIST: Record<string, string> = {
  'views/RoutinesView.tsx': 'the large empty-state illustration icon',
}

// Built from parts so this file carries no literal class into the Tailwind content scan.
const prefix = '(?<![\\w-])(?:[a-z-]+:)*text'
const TERTIARY = [
  new RegExp(`${prefix}-text-tertiary(?![\\w-])`),
  new RegExp(`${prefix}-\\[var\\(--text-tertiary\\)\\]`),
  /color:\s*['"`]var\(--text-tertiary\)/,
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

const posix = (path: string) => relative(renderer, path).split(sep).join('/')

function scan(file: string, text: string): string[] {
  return text.split('\n').flatMap((line, i) =>
    TERTIARY.some((re) => re.test(line)) ? [`${file}:${i + 1} ${line.trim().slice(0, 100)}`] : [],
  )
}

describe('text.tertiary in src/renderer', () => {
  it('is not used as a text colour outside the decorative allowlist', () => {
    const findings = sourceFiles(renderer)
      .filter((path) => !(posix(path) in DECORATIVE_ALLOWLIST))
      .flatMap((path) => scan(posix(path), readFileSync(path, 'utf8')))
    expect(findings).toEqual([])
  })

  it('lists only files that still use it', () => {
    const stale = Object.keys(DECORATIVE_ALLOWLIST).filter((file) => scan(file, readFileSync(join(renderer, file), 'utf8')).length === 0)
    expect(stale).toEqual([])
  })

  it('reports a tertiary text colour and ignores a border in that colour', () => {
    const tertiaryText = ['text', 'text', 'tertiary'].join('-')
    expect(scan('probe.tsx', `<p className="${tertiaryText}">`)).toHaveLength(1)
    expect(scan('probe.tsx', `<p className="hover:${tertiaryText}">`)).toHaveLength(1)
    expect(scan('probe.tsx', `style={{ color: 'var(--text-tertiary)' }}`)).toHaveLength(1)
    expect(scan('probe.tsx', `<p className="border-[var(--text-tertiary)]">`)).toHaveLength(0)
    expect(scan('probe.tsx', `<p className="text-text-secondary">`)).toHaveLength(0)
  })
})
