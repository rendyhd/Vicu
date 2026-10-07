import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// shared-parser-spec.md quotes the size of the shared corpus; keep it true when cases are added.
describe('shared-parser-spec.md', () => {
  it('states how many cases the shared corpus has', () => {
    const corpus = JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'nlp-corpus-v1.json'), 'utf8')) as {
      cases: unknown[]
    }
    const spec = readFileSync(join(process.cwd(), 'shared-parser-spec.md'), 'utf8')
    const stated = /nlp-corpus-v1\.json`\s*\((\d+) cases/.exec(spec)
    expect(stated, 'the spec names the corpus and its size').not.toBeNull()
    expect(Number(stated![1])).toBe(corpus.cases.length)
  })
})
