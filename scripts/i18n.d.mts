// Types for scripts/i18n.mjs, so the tests (TypeScript) can import it.
export const ROOT: string
export const SOURCE_LANGUAGE: string
export const BASELINE_FILE: string

export type CatalogTree = { [key: string]: unknown }

export function flatten(tree: unknown, problems?: string[], prefix?: string): Map<string, string>
export function splitPlural(key: string): { base: string; form: string | null }
export function placeholders(text: string): string[]
export function tags(text: string): string[]
export function pluralForms(tag: string): string[]
export function readJson(path: string): CatalogTree
export function catalogLanguages(root?: string): string[]
export function checkSource(source: unknown): string[]
export function checkTranslation(tag: string, translation: unknown, source: unknown): string[]
export function checkCatalogs(root?: string): string[]
export function catalogStatus(root?: string): Array<{ tag: string; translated: number; total: number; missing: string[] }>
export function unusedKeys(root?: string): string[]

export interface HardcodedText {
  line: number
  text: string
}
export function hardcodedIn(ts: unknown, fileName: string, code: string): HardcodedText[]
export function scanHardcoded(root?: string): Promise<Map<string, HardcodedText[]>>
export function readBaseline(root?: string): Record<string, number>
export function compareBaseline(
  scan: Map<string, HardcodedText[]>,
  baseline: Record<string, number>,
): {
  grown: Array<{ file: string; before: number; now: number; found: HardcodedText[] }>
  shrunk: Array<{ file: string; before: number; now: number }>
}
