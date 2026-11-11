#!/usr/bin/env node
// Builds the macOS calendar helper (native/calendar-macos/VicuCalendar.swift) into
// resources/calendar/vicu-calendar-macos, a universal binary (arm64 + x86_64) with the helper's
// Info.plist linked in (the usage strings macOS shows when it asks for the calendars).
// electron-builder ships it with the rest of resources/ and signs it with the app's entitlements
// (build/entitlements.mac.plist has the calendars entitlement). On other systems this does
// nothing: EventKit calendars are a macOS kind (docs/calendar-plan.md 2d).

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'native', 'calendar-macos', 'VicuCalendar.swift')
const plist = join(root, 'native', 'calendar-macos', 'Info.plist')
const outDir = join(root, 'resources', 'calendar')
const out = join(outDir, 'vicu-calendar-macos')

if (process.platform !== 'darwin') {
  console.log('[calendar-helper] not macOS: nothing to build')
  process.exit(0)
}

const ifStale = process.argv.includes('--if-stale')
if (ifStale && existsSync(out)) {
  const built = statSync(out).mtimeMs
  if (built >= statSync(source).mtimeMs && built >= statSync(plist).mtimeMs) {
    console.log('[calendar-helper] up to date')
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
console.log(`[calendar-helper] built ${out}`)
