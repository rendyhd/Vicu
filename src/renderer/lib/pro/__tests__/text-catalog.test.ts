import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { PRO_TEXT_KEYS } from '../text-keys'
import { renderProDocumentWith, textDateFormat } from '../text'
import type { ProDocument } from '../../../../shared/pro/documents'

const root = resolve(__dirname, '..', '..', '..', '..', '..')
const json = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf-8'))
const documents = json('test-fixtures/cross-app-semantics-v1.json').pro.documents as {
  messages: Record<string, string>
  cases: Array<{ name: string; document: ProDocument; text: string[]; html: string; markdown: string[] }>
}
const catalog = json('locales/en.json') as { proText: unknown }

function flatten(node: unknown, prefix = ''): Record<string, string> {
  if (typeof node === 'string') return { [prefix]: node }
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) Object.assign(out, flatten(value, prefix ? `${prefix}.${key}` : key))
  return out
}

/** A message key without its plural ending: what a document names. */
const base = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, '')

// Text Vicu writes for other people (cross-app semantics 21.19): the contract pins the English, the
// catalog holds it under `proText` so it can be translated, and the two must stay the same text.
describe('the catalog of text for other people', () => {
  it('holds the pinned English, key for key', () => {
    expect(flatten(catalog.proText)).toEqual(documents.messages)
  })

  it('has a catalog key for every sentence a document can hold, and no other', () => {
    expect(Object.keys(PRO_TEXT_KEYS).sort()).toEqual([...new Set(Object.keys(documents.messages).map(base))].sort())
    for (const [key, catalogKey] of Object.entries(PRO_TEXT_KEYS)) expect(catalogKey).toBe(`proText.${key}`)
  })

  it('writes days in English as the region does when the app is in English, else as en-GB', () => {
    expect(textDateFormat('en', { locale: 'en-US', hour12: true })).toEqual({ locale: 'en-US', hour12: false })
    expect(textDateFormat('en', { locale: 'nl-NL', hour12: false })).toEqual({ locale: 'en-GB', hour12: false })
    expect(textDateFormat('nl', { locale: 'en-US', hour12: true })).toEqual({ locale: 'nl', hour12: false })
  })

  // The same documents the shared suite renders with the fixture's own messages, here through
  // i18next and the catalog: plurals, placeholders and the three forms come out the same.
  for (const c of documents.cases) {
    it(`renders through the catalog: ${c.name}`, async () => {
      const rendered = await renderProDocumentWith(c.document, 'en', { locale: 'en-GB', hour12: false }, new Date(2026, 10, 12, 12))
      expect(rendered.text.split('\n')).toEqual(c.text)
      expect(rendered.html).toBe(c.html)
      expect(rendered.markdown.split('\n')).toEqual(c.markdown)
    })
  }
})
