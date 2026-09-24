import { existsSync, lstatSync, rmSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(projectDir, 'out')

if (dirname(outDir) !== projectDir || basename(outDir) !== 'out') {
  throw new Error(`Refusing to clean unexpected output path: ${outDir}`)
}

if (existsSync(outDir)) {
  if (lstatSync(outDir).isSymbolicLink()) {
    throw new Error(`Refusing to clean symlinked output path: ${outDir}`)
  }
  rmSync(outDir, { recursive: true, force: true })
}
