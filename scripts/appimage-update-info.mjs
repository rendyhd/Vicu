#!/usr/bin/env node
// Makes the Linux AppImages updateable (https://docs.appimage.org/packaging-guide/optional/updates.html).
// electron-builder leaves the runtime's `.upd_info` ELF section empty and writes no .zsync file, so
// AppImage managers (AppImageUpdate, Gear Lever, AppImageLauncher, AM ...) cannot tell where a newer
// version lives. For every AppImage in dist/ this script:
//
//   1. writes the update information into `.upd_info`, pointing at the GitHub releases of this
//      repository for the AppImage's own architecture, e.g.
//      gh-releases-zsync|rendyhd|Vicu|latest|Vicu-*-x86_64.AppImage.zsync
//   2. runs zsyncmake to write <AppImage>.zsync next to it (the file the update information names);
//   3. with --upload <tag>, uploads both to that GitHub release with `gh release upload`.
//
// It has to run after electron-builder and before anything is uploaded (the .zsync describes the
// final bytes), which is why CI and dist:linux:publish build with `--publish never` and upload here.
//
//   node scripts/appimage-update-info.mjs [--dir dist] [--optional] [--upload <tag>]
//
// --optional skips the .zsync with a warning when zsyncmake is missing (a local dist:linux still
// gets the update information); without it a missing zsyncmake fails (Debian/Ubuntu: apt install
// zsync).

import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, writeSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The GitHub repository the releases come from (https://github.com/rendyhd/Vicu/releases/). */
export const RELEASES_REPO = { owner: 'rendyhd', repo: 'Vicu' }

const UPDATE_INFO_SECTION = '.upd_info'

/**
 * The update information for one AppImage: the file name with its version replaced by `*`, so it
 * keeps matching the AppImage of the same architecture in later releases.
 * `Vicu-2.6.3-x86_64.AppImage` -> `gh-releases-zsync|rendyhd|Vicu|latest|Vicu-*-x86_64.AppImage.zsync`
 */
export function updateInformation(fileName, version, repo = RELEASES_REPO) {
  const marker = `-${version}-`
  if (!fileName.endsWith('.AppImage') || !fileName.includes(marker)) {
    throw new Error(`${fileName} is not named <name>-${version}-<arch>.AppImage`)
  }
  const pattern = fileName.replace(marker, '-*-')
  return `gh-releases-zsync|${repo.owner}|${repo.repo}|latest|${pattern}.zsync`
}

/**
 * Where a section lives in an ELF file, from its section headers. `read(position, length)` returns
 * the bytes at that position, so the whole AppImage never has to be in memory.
 */
export function findElfSection(read, name) {
  const ident = read(0, 64)
  if (ident.readUInt32BE(0) !== 0x7f454c46) throw new Error('not an ELF file')
  const is64 = ident[4] === 2
  const le = ident[5] === 1
  const u16 = (b, o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o))
  const u32 = (b, o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o))
  const word = (b, o) => (is64 ? Number(le ? b.readBigUInt64LE(o) : b.readBigUInt64BE(o)) : u32(b, o))

  const shoff = word(ident, is64 ? 0x28 : 0x20)
  const shentsize = u16(ident, is64 ? 0x3a : 0x2e)
  const shnum = u16(ident, is64 ? 0x3c : 0x30)
  const shstrndx = u16(ident, is64 ? 0x3e : 0x32)
  if (!shoff || !shnum) throw new Error('the ELF file has no section headers')

  const headers = read(shoff, shentsize * shnum)
  const section = (i) => {
    const o = i * shentsize
    return {
      nameOffset: u32(headers, o),
      offset: word(headers, o + (is64 ? 0x18 : 0x10)),
      size: word(headers, o + (is64 ? 0x20 : 0x14)),
    }
  }
  const strings = section(shstrndx)
  const names = read(strings.offset, strings.size)
  for (let i = 0; i < shnum; i++) {
    const s = section(i)
    const end = names.indexOf(0, s.nameOffset)
    if (names.toString('latin1', s.nameOffset, end) === name) return { offset: s.offset, size: s.size }
  }
  return null
}

/** Writes `info` into the AppImage's `.upd_info` section, zero-padded to the section's size. */
export function writeUpdateInformation(file, info) {
  const fd = openSync(file, 'r+')
  try {
    const read = (position, length) => {
      const buffer = Buffer.alloc(length)
      const got = readSync(fd, buffer, 0, length, position)
      if (got !== length) throw new Error(`${file}: short read at ${position}`)
      return buffer
    }
    const section = findElfSection(read, UPDATE_INFO_SECTION)
    if (!section) throw new Error(`${file}: the AppImage runtime has no ${UPDATE_INFO_SECTION} section`)
    const bytes = Buffer.from(info, 'utf8')
    if (bytes.length >= section.size) {
      throw new Error(`${file}: update information is ${bytes.length} bytes, ${UPDATE_INFO_SECTION} holds ${section.size - 1}`)
    }
    const padded = Buffer.alloc(section.size)
    bytes.copy(padded)
    writeSync(fd, padded, 0, padded.length, section.offset)
  } finally {
    closeSync(fd)
  }
}

function hasCommand(command) {
  try {
    execFileSync(command, ['-V'], { stdio: 'ignore' })
    return true
  } catch (error) {
    return error.code !== 'ENOENT'
  }
}

function main(argv) {
  const arg = (flag) => {
    const i = argv.indexOf(flag)
    return i === -1 ? undefined : argv[i + 1]
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const dir = arg('--dir') ?? join(root, 'dist')
  const optional = argv.includes('--optional')
  const tag = arg('--upload')
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

  // Only this version's AppImages: dist/ can still hold older builds.
  const appImages = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.AppImage') && f.includes(`-${version}-`))
    : []
  if (appImages.length === 0) throw new Error(`no AppImage of version ${version} in ${dir}`)

  const zsync = hasCommand('zsyncmake')
  if (!zsync) {
    if (!optional || tag) throw new Error('zsyncmake not found (Debian/Ubuntu: apt install zsync)')
    console.warn('zsyncmake not found: writing the update information without .zsync files')
  }

  const uploads = []
  for (const name of appImages) {
    const file = join(dir, name)
    const info = updateInformation(name, version)
    writeUpdateInformation(file, info)
    console.log(`${name}: ${info}`)
    uploads.push(file)
    if (zsync) {
      // -u is relative, so the .zsync resolves the AppImage next to itself on the release.
      execFileSync('zsyncmake', ['-u', basename(file), '-o', `${file}.zsync`, file], { cwd: dir, stdio: 'inherit' })
      uploads.push(`${file}.zsync`)
    }
  }

  if (tag) {
    execFileSync('gh', ['release', 'upload', tag, ...uploads, '--clobber'], { stdio: 'inherit' })
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
