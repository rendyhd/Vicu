/// <reference types="vite/client" />
import en from '../../../locales/en.json'
import { PSEUDO_LANGUAGE, SOURCE_LANGUAGE } from './languages'
import { pseudoCatalog, type CatalogTree } from './pseudo'

// The catalogs: one JSON file per language in `locales/`, named by its BCP 47 tag. English is the
// source and is always in the bundle; every other language is its own chunk, loaded when chosen.
// A new language is one new file: nothing here or anywhere else lists the languages.

/** The source catalog. Its shape is the type of every translation key (index.ts). */
export const SOURCE_CATALOG = en

const loaders = import.meta.glob<CatalogTree>(
  ['../../../locales/*.json', '!../../../locales/en.json'],
  { import: 'default' },
)

const tagOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1, -'.json'.length)

const byTag = new Map(Object.entries(loaders).map(([path, load]) => [tagOf(path), load]))

/**
 * The languages this build can show, English first, then by tag. The pseudo-language is offered
 * in development only.
 */
export function availableLanguages(pseudo: boolean = import.meta.env.DEV): string[] {
  const tags = [SOURCE_LANGUAGE, ...[...byTag.keys()].sort()]
  return pseudo ? [...tags, PSEUDO_LANGUAGE] : tags
}

/** A language's catalog, or null when there is none (or it cannot be read). English is not loaded here. */
export async function loadCatalog(tag: string): Promise<CatalogTree | null> {
  if (tag === PSEUDO_LANGUAGE) return pseudoCatalog(en)
  const load = byTag.get(tag)
  if (!load) return null
  try {
    return await load()
  } catch {
    return null
  }
}
