import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// A component draws with the design token roles (Tailwind classes such as bg-accent-blue/12, var(--x),
// or rgb(var(--x-rgb) / a)), never with a hex or an rgb()/rgba()/hsl() literal: a literal does not
// follow the theme, forced colours or a change of design-tokens-v1.json. This scans the .tsx files of
// the renderer; the files below hold colours that are data, not styling.

const renderer = resolve(__dirname, '..', '..')

const ALLOWED: Record<string, string> = {
  'components/sidebar/ProjectTree.tsx':
    'the colour picker of the project dialog: swatches the user chooses from; the choice is stored on the project (data)',
  'components/sidebar/TagList.tsx':
    'the colour picker of the label dialog: swatches the user chooses from; the choice is stored on the label (data)',
  'components/settings/ProjectSettings.tsx': 'the example "#3498db" in the placeholder of the project colour field',
  'views/RoutinesView.tsx':
    'STORED_ROUTINE_COLORS: the colours written into the routine definition and read by Android (cross-app data, not themed)',
}

const HEX = /#[0-9a-fA-F]{3,8}\b/
// rgb(var(--x-rgb) / a) is the channel form and is how a role gets an alpha; anything else is a literal.
const FUNCTION = /\b(?:rgba?|hsla?)\(\s*(?!var\()/

function tsxFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') found.push(...tsxFiles(full))
    } else if (entry.name.endsWith('.tsx')) {
      found.push(full)
    }
  }
  return found
}

const files = tsxFiles(renderer).map((full) => [relative(renderer, full).replace(/\\/g, '/'), readFileSync(full, 'utf-8')] as const)

describe('no raw colours in components', () => {
  it('scans the renderer components', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('has no hex or rgb()/rgba()/hsl() literal outside the allowlist', () => {
    const offenders = files
      .filter(([path, source]) => (HEX.test(source) || FUNCTION.test(source)) && !(path in ALLOWED))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('lists no file that is clean (the allowlist stays honest)', () => {
    for (const path of Object.keys(ALLOWED)) {
      const entry = files.find(([file]) => file === path)
      expect(entry, path).toBeDefined()
      expect(HEX.test(entry![1]) || FUNCTION.test(entry![1]), path).toBe(true)
    }
  })

  it('would catch the shapes it exists for', () => {
    expect(HEX.test('className="text-[#16a34a]"')).toBe(true)
    expect(FUNCTION.test("background: 'rgba(34, 197, 94, 0.15)'")).toBe(true)
    expect(FUNCTION.test('className="bg-[rgb(1,2,3)]"')).toBe(true)
    expect(FUNCTION.test("background: 'rgb(var(--accent-purple-rgb) / 0.15)'")).toBe(false)
  })
})
