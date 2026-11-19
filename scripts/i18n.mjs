#!/usr/bin/env node
// Translations: checks and reports (docs/translating.md, CLAUDE.md "Translations").
//
//   node scripts/i18n.mjs check              every catalog in locales/ against the English source; exit 1 on a problem
//   node scripts/i18n.mjs status             how much of the app each language covers
//   node scripts/i18n.mjs hardcoded          text still written in the code instead of the catalog, per file
//   node scripts/i18n.mjs hardcoded --update rewrite the baseline after moving text into the catalog
//
// The same functions run in the test suite (src/shared/i18n/__tests__/catalogs.test.ts,
// src/renderer/lib/__tests__/hardcoded-text.test.ts), so `npm test` fails on what `check` reports.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const SOURCE_LANGUAGE = 'en'
export const BASELINE_FILE = 'src/renderer/lib/__tests__/hardcoded-text-baseline.json'

/** The plural forms a language can have (CLDR); a plural key ends in `_` plus one of these. */
const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other']
const PLURAL_ENDING = new RegExp(`_(${PLURAL_FORMS.join('|')})$`)
/** A key's parts are words in lowerCamelCase: `settings.language.label`. */
/** HTML elements that never have content. A tag around text named like one loses that text in `<Trans>`. */
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const KEY_PART = /^[a-z][A-Za-z0-9]*$/

// ---------------------------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------------------------

/** Every leaf of a catalog as `path.to.key` -> text; anything that is not text is a problem. */
export function flatten(tree, problems = [], prefix = '') {
  const out = new Map()
  if (tree === null || typeof tree !== 'object' || Array.isArray(tree)) {
    problems.push(`${prefix || 'the file'}: must be an object of keys`)
    return out
  }
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out.set(path, value)
    else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of flatten(value, problems, path)) out.set(k, v)
    } else problems.push(`${path}: must be text or a group of keys`)
  }
  return out
}

/** `completion.toast_other` -> { base: 'completion.toast', form: 'other' }; a plain key has no form. */
export function splitPlural(key) {
  const match = PLURAL_ENDING.exec(key)
  return match ? { base: key.slice(0, match.index), form: match[1] } : { base: key, form: null }
}

/** The `{{names}}` a text fills in, sorted (a format after a comma, `{{count, number}}`, is not part of the name). */
export function placeholders(text) {
  return [...text.matchAll(/\{\{\s*([^},\s]+)[^}]*\}\}/g)].map((m) => m[1]).sort()
}

/** The `<tags>` a text carries (opening, closing and self-closing alike), sorted. */
export function tags(text) {
  return [...text.matchAll(/<\/?\s*([A-Za-z0-9]+)\s*\/?>/g)].map((m) => m[0].replace(/\s+/g, '')).sort()
}

/** The plural forms a language needs, from the platform's CLDR data ("one", "other" for English). */
export function pluralForms(tag) {
  return new Intl.PluralRules(tag).resolvedOptions().pluralCategories
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\ufeff/, ''))
}

/** The language tags with a catalog in `locales/`, the source first. */
export function catalogLanguages(root = ROOT) {
  const tags = readdirSync(join(root, 'locales'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
  return [SOURCE_LANGUAGE, ...tags.filter((t) => t !== SOURCE_LANGUAGE).sort()]
}

/** Problems of the English source catalog itself. */
export function checkSource(source) {
  const problems = []
  const flat = flatten(source, problems)
  const groups = new Map()
  for (const [key, text] of flat) {
    const { base, form } = splitPlural(key)
    const last = base.slice(base.lastIndexOf('.') + 1)
    for (const part of base.split('.')) {
      if (!KEY_PART.test(part)) problems.push(`${key}: "${part}" is not a lowerCamelCase word`)
    }
    if (text.trim() === '') problems.push(`${key}: is empty`)
    if (text !== text.trim()) problems.push(`${key}: starts or ends with a space`)
    for (const [, name] of text.matchAll(/<\/\s*([A-Za-z0-9]+)\s*>/g)) {
      if (VOID_ELEMENTS.has(name.toLowerCase())) problems.push(`${key}: <${name}> is an HTML element without content; name the tag after what it is (<guide>, <name>)`)
    }
    if (form) {
      if (!groups.has(base)) groups.set(base, new Set())
      groups.get(base).add(form)
      if (flat.has(base)) problems.push(`${base}: is both a plain key and a plural key (${last}_${form})`)
    }
  }
  const wanted = pluralForms(SOURCE_LANGUAGE)
  for (const [base, forms] of groups) {
    for (const form of wanted) if (!forms.has(form)) problems.push(`${base}: the plural form _${form} is missing`)
    for (const form of forms) if (!wanted.includes(form)) problems.push(`${base}_${form}: English has no plural form "${form}"`)
  }
  return problems
}

/** Problems of one translation against the source. A missing key is never a problem: it reads English. */
export function checkTranslation(tag, translation, source) {
  const problems = []
  let canonical = null
  try {
    const locale = new Intl.Locale(tag)
    // Language codes are two or three letters ("dutch" has the form of a tag but is none).
    if (locale.language.length <= 3) canonical = locale.baseName
  } catch { /* reported below */ }
  if (canonical !== tag) {
    problems.push(`the file name "${tag}.json" is not a language tag${canonical ? ` in its usual spelling (use "${canonical}.json")` : ' (such as "de", "pt-BR", "zh-Hans")'}`)
    if (!canonical) return problems
  }
  const sourceFlat = flatten(source)
  const sourcePlurals = new Map()
  for (const [key, text] of sourceFlat) {
    const { base, form } = splitPlural(key)
    if (!form) continue
    if (!sourcePlurals.has(base)) sourcePlurals.set(base, [])
    sourcePlurals.get(base).push(text)
  }
  const flat = flatten(translation, problems)
  const wanted = pluralForms(tag)
  const translatedPlurals = new Map()

  for (const [key, text] of flat) {
    const { base, form } = splitPlural(key)
    const plural = form !== null && sourcePlurals.has(base)
    if (!plural && !sourceFlat.has(key)) {
      problems.push(`${key}: is not a key of ${SOURCE_LANGUAGE}.json (renamed or removed there, or misspelled here)`)
      continue
    }
    if (text.trim() === '') {
      problems.push(`${key}: is empty (leave a key out to show the English text)`)
      continue
    }
    const sourceTexts = plural ? sourcePlurals.get(base) : [sourceFlat.get(key)]
    const allowed = new Set(sourceTexts.flatMap(placeholders))
    const used = placeholders(text)
    for (const name of used) {
      if (!allowed.has(name)) problems.push(`${key}: {{${name}}} is not in the English text (placeholders keep their English names)`)
    }
    if (plural) {
      if (!wanted.includes(form)) problems.push(`${key}: ${tag} has no plural form "${form}" (it has ${wanted.join(', ')})`)
      if (!translatedPlurals.has(base)) translatedPlurals.set(base, new Set())
      translatedPlurals.get(base).add(form)
    } else {
      for (const name of allowed) {
        if (!used.includes(name)) problems.push(`${key}: {{${name}}} of the English text is missing`)
      }
    }
    const sourceTags = [...new Set(sourceTexts.map((s) => tags(s).join(' ')))]
    if (!sourceTags.includes(tags(text).join(' '))) {
      problems.push(`${key}: the tags differ from the English text (expected ${sourceTags[0] || 'none'})`)
    }
  }
  for (const [base, forms] of translatedPlurals) {
    for (const form of wanted) {
      if (!forms.has(form)) problems.push(`${base}: the plural form _${form} is missing (${tag} needs ${wanted.map((f) => '_' + f).join(', ')})`)
    }
  }
  return problems
}

/** Every problem of every catalog, as `file: problem` lines. */
export function checkCatalogs(root = ROOT) {
  const problems = []
  const sourcePath = join(root, 'locales', `${SOURCE_LANGUAGE}.json`)
  let source
  try {
    source = readJson(sourcePath)
  } catch (err) {
    return [`locales/${SOURCE_LANGUAGE}.json: cannot be read as JSON (${err.message})`]
  }
  for (const p of checkSource(source)) problems.push(`locales/${SOURCE_LANGUAGE}.json: ${p}`)
  for (const tag of catalogLanguages(root).slice(1)) {
    let translation
    try {
      translation = readJson(join(root, 'locales', `${tag}.json`))
    } catch (err) {
      problems.push(`locales/${tag}.json: cannot be read as JSON (${err.message})`)
      continue
    }
    for (const p of checkTranslation(tag, translation, source)) problems.push(`locales/${tag}.json: ${p}`)
  }
  return problems
}

/** Per language: how many of the source's texts it has (a plural key counts once, when complete). */
export function catalogStatus(root = ROOT) {
  const source = flatten(readJson(join(root, 'locales', `${SOURCE_LANGUAGE}.json`)))
  const bases = new Set([...source.keys()].map((k) => splitPlural(k).base))
  return catalogLanguages(root).map((tag) => {
    if (tag === SOURCE_LANGUAGE) return { tag, translated: bases.size, total: bases.size, missing: [] }
    const flat = flatten(readJson(join(root, 'locales', `${tag}.json`)))
    const have = new Set([...flat.keys()].map((k) => splitPlural(k).base))
    const missing = [...bases].filter((b) => !have.has(b))
    return { tag, translated: bases.size - missing.length, total: bases.size, missing }
  })
}

// ---------------------------------------------------------------------------------------------
// Source files
// ---------------------------------------------------------------------------------------------

function walk(dir, keep, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, keep, out)
    else if (keep(name)) out.push(path)
  }
  return out
}

const isCode = (name) => /\.tsx?$/.test(name) && !name.endsWith('.d.ts')

/** The source keys no code mentions. A key is used when its full name appears as a quoted literal. */
export function unusedKeys(root = ROOT) {
  const source = flatten(readJson(join(root, 'locales', `${SOURCE_LANGUAGE}.json`)))
  const bases = [...new Set([...source.keys()].map((k) => splitPlural(k).base))]
  const code = walk(join(root, 'src'), isCode).map((path) => readFileSync(path, 'utf8')).join('\n')
  return bases.filter((key) => !["'", '"', '`'].some((q) => code.includes(q + key + q)))
}

// ---------------------------------------------------------------------------------------------
// Hardcoded text
// ---------------------------------------------------------------------------------------------

/** JSX attributes whose value a person reads or hears. */
const TEXT_ATTRIBUTES = new Set([
  'aria-label', 'aria-description', 'aria-roledescription', 'aria-valuetext', 'aria-placeholder',
  'title', 'placeholder', 'alt', 'label',
])
/** Object properties that usually hold text for a person (menus, options, dialogs, notifications). */
const TEXT_PROPERTIES = new Set([
  'label', 'ariaLabel', 'placeholder', 'tooltip', 'toolTip', 'hint', 'note', 'title', 'description',
  'message', 'detail', 'body', 'buttons',
])
/** Calls whose text argument is shown or read aloud: `toast.error('...')`, `announce('...')`. */
const TEXT_CALLS = new Set(['announce'])
const TEXT_CALL_OBJECTS = new Set(['toast', 'toasts'])

/** Two letters in a row: text, not a symbol, a number or a one-letter key cap. */
const HAS_WORD = /\p{L}{2,}/u
/** One lowercase word or a dotted, dashed or slashed name: an id, a key, a path, not a sentence. */
const LOOKS_LIKE_ID = /^[a-z0-9]+([._:/-][A-Za-z0-9]+)*$/

/**
 * The hardcoded texts of one source file: `{ line, text }` for JSX text, text attributes, text in
 * JSX expressions, text properties and text calls. A line with `i18n-ignore` in a comment on it or
 * right above it is skipped (text that is the same in every language: a brand, a format example).
 */
export function hardcodedIn(ts, fileName, code) {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const lines = code.split('\n')
  const found = []
  const ignored = (line) => /i18n-ignore/.test(lines[line] ?? '') || /i18n-ignore/.test(lines[line - 1] ?? '')
  const add = (node, text) => {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (!HAS_WORD.test(clean)) return
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line
    if (!ignored(line)) found.push({ line: line + 1, text: clean })
  }
  /** The text of a string or template literal (`${...}` parts left out), or null for anything else. */
  const literal = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((s) => s.literal.text).join(' ')
    return null
  }
  /** Text an expression can end up showing: literals, and the branches of `a ? b : c`, `a && b`, `a || b`, `a ?? b`. */
  const shown = (node, visit) => {
    if (ts.isParenthesizedExpression(node)) return shown(node.expression, visit)
    if (ts.isConditionalExpression(node)) {
      shown(node.whenTrue, visit)
      shown(node.whenFalse, visit)
      return
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) return shown(node.right, visit)
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
        shown(node.left, visit)
        shown(node.right, visit)
      }
      return
    }
    const text = literal(node)
    if (text !== null) visit(node, text)
  }
  const sentence = (node, text) => { if (!LOOKS_LIKE_ID.test(text.trim())) add(node, text) }

  const visit = (node) => {
    if (ts.isJsxText(node)) add(node, node.text)
    else if (ts.isJsxAttribute(node) && node.initializer && TEXT_ATTRIBUTES.has(node.name.getText(source))) {
      if (ts.isStringLiteral(node.initializer)) add(node, node.initializer.text)
      else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) shown(node.initializer.expression, sentence)
    } else if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      shown(node.expression, sentence)
    } else if (ts.isPropertyAssignment(node) && TEXT_PROPERTIES.has(node.name.getText(source).replace(/['"]/g, ''))) {
      if (ts.isArrayLiteralExpression(node.initializer)) for (const el of node.initializer.elements) shown(el, sentence)
      else shown(node.initializer, sentence)
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const callee = node.expression
      const direct = ts.isIdentifier(callee) && TEXT_CALLS.has(callee.text)
      const onObject = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && TEXT_CALL_OBJECTS.has(callee.expression.text)
      if (direct || onObject) for (const arg of node.arguments) shown(arg, sentence)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** Where hardcoded text is looked for: the windows and the main process. */
const SCANNED = ['src/renderer', 'src/main']

/** Every file with hardcoded text: repo-relative path (forward slashes) -> its texts. */
export async function scanHardcoded(root = ROOT) {
  const ts = (await import('typescript')).default
  const out = new Map()
  for (const dir of SCANNED) {
    for (const path of walk(join(root, dir), isCode)) {
      const found = hardcodedIn(ts, path, readFileSync(path, 'utf8'))
      if (found.length > 0) out.set(relative(root, path).split('\\').join('/'), found)
    }
  }
  return out
}

/** The baseline: how many hardcoded texts each file had when it was last written (file -> count). */
export function readBaseline(root = ROOT) {
  const path = join(root, BASELINE_FILE)
  return existsSync(path) ? readJson(path) : {}
}

/**
 * The scan against the baseline. `grown`: files with more hardcoded text than recorded (new text
 * that belongs in the catalog). `shrunk`: files with less (the baseline needs `--update`, so the
 * gain cannot be lost again).
 */
export function compareBaseline(scan, baseline) {
  const grown = []
  const shrunk = []
  for (const [file, found] of scan) {
    const before = baseline[file] ?? 0
    if (found.length > before) grown.push({ file, before, now: found.length, found })
    else if (found.length < before) shrunk.push({ file, before, now: found.length })
  }
  for (const [file, before] of Object.entries(baseline)) {
    if (!scan.has(file)) shrunk.push({ file, before, now: 0 })
  }
  return { grown, shrunk }
}

function writeBaseline(scan, root = ROOT) {
  const sorted = Object.fromEntries([...scan].map(([file, found]) => [file, found.length]).sort(([a], [b]) => (a < b ? -1 : 1)))
  writeFileSync(join(root, BASELINE_FILE), JSON.stringify(sorted, null, 2) + '\n')
}

// ---------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------

async function main(argv) {
  const [command, ...flags] = argv
  if (command === 'check') {
    const problems = checkCatalogs()
    for (const key of unusedKeys()) problems.push(`locales/${SOURCE_LANGUAGE}.json: ${key}: no code uses this key (remove it, here and in the translations)`)
    if (problems.length === 0) {
      console.log(`Translations: ${catalogLanguages().length} catalogs, no problems.`)
      return 0
    }
    for (const p of problems) console.error(p)
    console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}. See docs/translating.md.`)
    return 1
  }
  if (command === 'status') {
    const verbose = flags.includes('--missing')
    for (const row of catalogStatus()) {
      const percent = row.total === 0 ? 100 : Math.floor((row.translated / row.total) * 100)
      console.log(`${row.tag.padEnd(10)} ${String(percent).padStart(3)}%  ${row.translated}/${row.total}`)
      if (verbose) for (const key of row.missing) console.log(`           missing ${key}`)
    }
    return 0
  }
  if (command === 'hardcoded') {
    const scan = await scanHardcoded()
    if (flags.includes('--update')) {
      writeBaseline(scan)
      console.log(`Wrote ${BASELINE_FILE}.`)
    }
    const only = flags.find((f) => !f.startsWith('--'))
    let total = 0
    for (const [file, found] of [...scan].sort(([, a], [, b]) => b.length - a.length)) {
      total += found.length
      if (only) {
        if (file.includes(only)) for (const item of found) console.log(`${file}:${item.line}  ${item.text}`)
      } else console.log(`${String(found.length).padStart(5)}  ${file}`)
    }
    console.log(`\n${total} hardcoded texts in ${scan.size} files (a file name as argument lists its texts).`)
    return 0
  }
  console.error('Usage: node scripts/i18n.mjs check | status [--missing] | hardcoded [file] [--update]')
  return 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code })
}
