import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { generateTokensCss, loadTokens } from '../../../../scripts/gen-tokens.mjs'

// Card 1.5 guard (motion). Components take their durations from the motion roles in the Tailwind
// theme (transitionDuration in tailwind.config.ts), which read the --dur-* variables of tokens.css.
// A millisecond class such as duration-200 or an arbitrary duration-[300ms] is a raw value and
// fails here. A role class must name a role the theme defines.

const root = resolve(__dirname, '..', '..', '..', '..')
const renderer = resolve(__dirname, '..', '..')
const posix = (path: string) => relative(renderer, path).split(sep).join('/')

/** Component and markup files under src/renderer, skipping __tests__ and *.test.ts. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path)
    const scanned = /\.(ts|tsx|html)$/.test(entry.name) && !entry.name.endsWith('.test.ts')
    return scanned ? [path] : []
  })
}

// Built from parts so this file carries no literal class into the Tailwind content scan.
const tw = (...parts: string[]) => parts.join('')
const RAW_DURATION = new RegExp(tw('(?<![\\w-])duration-(\\d+|\\[[^\\]]*\\])'), 'g')
const ROLE_DURATION = new RegExp(tw('(?<![\\w-])duration-([a-z][\\w-]*)'), 'g')

/** The theme's extension, loaded the way tokens.test.ts loads it (a dynamic import keeps it out of the web typecheck). */
async function themeExtend(): Promise<Record<string, Record<string, string> | undefined>> {
  const { default: config } = await import(/* @vite-ignore */ pathToFileURL(resolve(root, 'tailwind.config.ts')).href)
  return config.theme?.extend ?? {}
}

/** Matches of a pattern in src/renderer, as "file:line match". */
function matches(pattern: RegExp): string[] {
  return sourceFiles(renderer).flatMap((path) =>
    readFileSync(path, 'utf8')
      .split('\n')
      .flatMap((text, i) => [...text.matchAll(pattern)].map((m) => `${posix(path)}:${i + 1} ${m[0]}`)),
  )
}

describe('Durations in src/renderer', () => {
  it('has no raw millisecond duration class', () => {
    expect(matches(RAW_DURATION)).toEqual([])
  })

  it('uses only duration roles that the theme defines', async () => {
    const durations = (await themeExtend()).transitionDuration ?? {}
    const undefinedRoles = matches(ROLE_DURATION).filter((line) => {
      const name = line.slice(line.lastIndexOf('duration-') + 'duration-'.length)
      return !(name in durations)
    })
    expect(undefinedRoles).toEqual([])
  })

  it('maps every duration role to a variable that tokens.css defines', async () => {
    const durations = (await themeExtend()).transitionDuration ?? {}
    const css = generateTokensCss(loadTokens())
    expect(Object.keys(durations).length).toBeGreaterThan(0)
    for (const [role, value] of Object.entries(durations)) {
      const m = /^var\((--dur-[a-z-]+)\)$/.exec(value)
      expect(m, role).not.toBeNull()
      expect(css, role).toContain(`  ${m![1]}: `)
    }
  })
})
