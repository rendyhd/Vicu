#!/usr/bin/env node
// Builds the macOS browser link helper (native/bridge-macos/VicuBridge.swift) into
// resources/bridge/vicu-bridge-macos, a universal binary (arm64 + x86_64) with the helper's
// Info.plist linked in (it gives the signature its own identifier, com.rendyhd.vicu.bridge).
// electron-builder ships it with the rest of resources/ and signs it with the app. It is the
// native-messaging host a browser starts on macOS, where the app can no longer run the bridge
// script as Node (scripts/electron-fuses.mjs). On other systems this does nothing: Windows and
// Linux still run resources/native-messaging-host/vicu-bridge.js.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'native', 'bridge-macos', 'VicuBridge.swift')
const plist = join(root, 'native', 'bridge-macos', 'Info.plist')
const outDir = join(root, 'resources', 'bridge')
const out = join(outDir, 'vicu-bridge-macos')

if (process.platform !== 'darwin') {
  console.log('[bridge-helper] not macOS: nothing to build')
  process.exit(0)
}

const ifStale = process.argv.includes('--if-stale')
if (ifStale && existsSync(out)) {
  const built = statSync(out).mtimeMs
  if (built >= statSync(source).mtimeMs && built >= statSync(plist).mtimeMs) {
    console.log('[bridge-helper] up to date')
    process.exit(0)
  }
}

mkdirSync(outDir, { recursive: true })
const parts = []
for (const arch of ['arm64', 'x86_64']) {
  const part = `${out}-${arch}`
  execFileSync('xcrun', [
    'swiftc', '-O',
    '-target', `${arch}-apple-macos11`,
    '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', plist,
    '-o', part,
    source,
  ], { stdio: 'inherit' })
  parts.push(part)
}
execFileSync('lipo', ['-create', ...parts, '-output', out], { stdio: 'inherit' })
for (const part of parts) rmSync(part, { force: true })
// Ad-hoc signature for local runs; a release build is signed again by electron-builder.
execFileSync('codesign', ['--force', '--sign', '-', out], { stdio: 'inherit' })
console.log(`[bridge-helper] built ${out}`)
