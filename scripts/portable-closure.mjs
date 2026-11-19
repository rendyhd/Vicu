// Which files a set of entry modules pulls in, and whether any of them needs Electron or Node.
//
// The web build (src/web) runs part of the main process's code in a browser. That part may reach
// the desktop only through the host seam (`@host/*`, src/main/host on the desktop and src/web/host
// on the web). This walks the value imports from the entry files (type-only imports are erased by
// the compiler and do not count) and lists every import of `electron` or a Node built-in.
//
//   node scripts/portable-closure.mjs <entry.ts> [more entries]     exit 1 when something leaks
//   node scripts/portable-closure.mjs --list <entry.ts>             also print the files
//
// `portableClosure` is exported for the guard test (src/web/__tests__/portable-closure.test.ts).
import { existsSync, readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'"\n;]*?\sfrom\s+)?['"]([^'"\n]+)['"]|import\(\s*['"]([^'"\n]+)['"]\s*\)|require\(\s*['"]([^'"\n]+)['"]\s*\)/g
const NODE_BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))

/** Path aliases of the web build: `@` is the renderer, `@host` the web side of the seam. */
const WEB_ALIASES = {
  '@host/': 'src/web/host/',
  '@/': 'src/renderer/',
}

function resolveFile(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

function resolveImport(from, spec, aliases) {
  if (spec.startsWith('.')) return resolveFile(resolve(dirname(from), spec))
  for (const [prefix, target] of Object.entries(aliases)) {
    if (spec.startsWith(prefix)) return resolveFile(resolve(REPO, target, spec.slice(prefix.length)))
  }
  return undefined
}

/**
 * @param {string[]} entries repo-relative entry files
 * @param {{ aliases?: Record<string, string>, seams?: string[] }} [options] `seams`: import prefixes
 *   that are not followed (the desktop side of the seam, when checking before the web side exists)
 * @returns {{ files: string[], leaks: Array<{ file: string, module: string }>, missing: Array<{ file: string, module: string }> }}
 */
export function portableClosure(entries, options = {}) {
  const aliases = options.aliases ?? WEB_ALIASES
  const seams = options.seams ?? []
  const seen = new Set()
  const leaks = []
  const missing = []
  const queue = entries.map((entry) => resolve(REPO, entry))
  while (queue.length > 0) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    if (!/\.(ts|tsx|mts|js|mjs)$/.test(file)) continue
    const name = relative(REPO, file).replace(/\\/g, '/')
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(IMPORT)) {
      if (match[1]) continue
      const spec = (match[2] || match[3] || match[4]).replace(/\?.*$/, '')
      if (seams.some((prefix) => spec.startsWith(prefix))) continue
      if (spec === 'electron' || NODE_BUILTINS.has(spec)) {
        leaks.push({ file: name, module: spec })
        continue
      }
      const target = resolveImport(file, spec, aliases)
      if (target) queue.push(target)
      else if (target === null) missing.push({ file: name, module: spec })
    }
  }
  return {
    files: [...seen].map((file) => relative(REPO, file).replace(/\\/g, '/')).sort(),
    leaks: leaks.sort((a, b) => a.file.localeCompare(b.file) || a.module.localeCompare(b.module)),
    missing,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const list = args.includes('--list')
  const seams = args.includes('--desktop-seam') ? ['@host/'] : []
  const entries = args.filter((arg) => !arg.startsWith('--'))
  if (entries.length === 0) {
    console.error('usage: node scripts/portable-closure.mjs [--list] [--desktop-seam] <entry.ts> ...')
    process.exit(2)
  }
  const { files, leaks, missing } = portableClosure(entries, { seams })
  if (list) for (const file of files) console.log(file)
  console.log(`${files.length} files`)
  for (const { file, module } of missing) console.log(`unresolved: ${file} imports ${module}`)
  for (const { file, module } of leaks) console.log(`leak: ${file} imports ${module}`)
  process.exit(leaks.length > 0 ? 1 : 0)
}
