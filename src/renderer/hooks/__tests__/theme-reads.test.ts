import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

// Components ask useIsDark() for the theme (one subscription for the app, D-REN-5) instead of
// reading the document class on every render.

const componentsDir = join(__dirname, '..', '..', 'components')
const viewsDir = join(__dirname, '..', '..', 'views')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

describe('theme reads in components and views', () => {
  it('go through useIsDark, not the DOM class', () => {
    const offenders: string[] = []
    for (const file of [...sourceFiles(componentsDir), ...sourceFiles(viewsDir)]) {
      if (/classList\.contains\(\s*['"]dark['"]\s*\)/.test(readFileSync(file, 'utf8'))) {
        offenders.push(relative(join(componentsDir, '..'), file).split(sep).join('/'))
      }
    }
    expect(offenders).toEqual([])
  })
})
