import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * The shared fixtures and documents are kept identical in vicu and vicu-android (CLAUDE.md,
 * "Cross-app contract"). When the Android checkout sits next to this repo, compare every shared
 * file after normalising line endings; without it the whole suite is skipped (CI has only this
 * repo). `VICU_ANDROID_DIR` points at a checkout somewhere else.
 *
 * Android keeps `custom-list-sync-v1.json` in `shared/src/commonTest/resources/`, so the pairs
 * are explicit instead of one path for both.
 */
const desktopRoot = process.cwd()
const androidRoot = process.env.VICU_ANDROID_DIR ? resolve(process.env.VICU_ANDROID_DIR) : resolve(desktopRoot, '..', 'vicu-android')
const siblingPresent = existsSync(join(androidRoot, 'test-fixtures')) && existsSync(join(androidRoot, 'docs'))

interface Pair {
  desktop: string
  android: string
}

const same = (path: string): Pair => ({ desktop: path, android: path })

const PAIRS: Pair[] = [
  same('test-fixtures/cross-app-semantics-v1.json'),
  same('test-fixtures/nlp-corpus-v1.json'),
  same('test-fixtures/routine-archive-v1.json'),
  same('test-fixtures/description-format-v1.json'),
  same('test-fixtures/design-tokens-v1.json'),
  { desktop: 'test-fixtures/custom-list-sync-v1.json', android: 'shared/src/commonTest/resources/custom-list-sync-v1.json' },
  same('docs/cross-app-semantics-v1.md'),
  same('docs/description-format-v1.md'),
  same('docs/design-system-v1.md'),
]

function normalised(path: string): string {
  return readFileSync(path, 'utf8').replace(/^\ufeff/, '').replace(/\r\n?/g, '\n')
}

/** Where two texts first differ, for a failure message that points at the line. */
function firstDifference(a: string, b: string): string {
  const la = a.split('\n')
  const lb = b.split('\n')
  const n = Math.max(la.length, lb.length)
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) return `line ${i + 1}: desktop "${(la[i] ?? '<end>').slice(0, 120)}" vs android "${(lb[i] ?? '<end>').slice(0, 120)}"`
  }
  return 'no difference found'
}

describe.skipIf(!siblingPresent)('shared contract files match the Android repo', () => {
  for (const pair of PAIRS) {
    it(pair.desktop, () => {
      const desktopFile = join(desktopRoot, pair.desktop)
      const androidFile = join(androidRoot, pair.android)
      expect(existsSync(desktopFile), `desktop has ${pair.desktop}`).toBe(true)
      expect(existsSync(androidFile), `android has ${pair.android}`).toBe(true)
      const desktop = normalised(desktopFile)
      const android = normalised(androidFile)
      expect(desktop === android, `${pair.desktop} differs: ${firstDifference(desktop, android)}`).toBe(true)
    })
  }
})
