#!/usr/bin/env node
// Makes the Linux AppImages updateable (https://docs.appimage.org/packaging-guide/optional/updates.html).
// electron-builder leaves the runtime's `.upd_info` ELF section empty and writes no .zsync file, so
// AppImage managers (AppImageUpdate, Gear Lever, AppImageLauncher, AM ...) cannot tell where a newer
// version lives. For every AppImage of this version in dist/ this script:
//
//   1. writes the update information into `.upd_info`, pointing at the GitHub releases of this
//      repository for the AppImage's own architecture, e.g.
//      gh-releases-zsync|rendyhd|Vicu|latest|Vicu-*-x86_64.AppImage.zsync
//      (`latest-all` instead of `latest` with --channel latest-all, for pre-releases: they then
//      follow newer pre-releases and the next stable, instead of being offered the older stable)
//   2. runs zsyncmake to write <AppImage>.zsync next to it (the file the update information names);
//   3. with --upload <tag>, uploads both to that GitHub release with `gh release upload`.
//
// It has to run after electron-builder and before anything is uploaded (the .zsync describes the
// final bytes), which is why the release workflow builds with `--publish never` and uploads here.
//
//   node scripts/appimage-update-info.mjs [--dir dist] [--channel latest|latest-all] [--optional]
//                                         [--upload <tag>]
//
// --optional skips the .zsync with a warning when zsyncmake is missing (a local dist:linux still
// gets the update information); without it a missing zsyncmake fails (Debian/Ubuntu: apt install
// zsync).

import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The GitHub repository the releases come from (https://github.com/rendyhd/Vicu/releases/). */
export const RELEASES_REPO = { owner: 'rendyhd', repo: 'Vicu' }

const UPDATE_INFO_SECTION = '.upd_info'

/** `latest`: the newest stable release. `latest-all`: the newest release, pre-releases included. */
export const UPDATE_CHANNELS = ['latest', 'latest-all']

/**
 * True for `<name>-<version>-<arch>.AppImage`. The arch has no hyphen, so a pre-release of the same
 * base version (`Vicu-2.6.3-beta.1-x86_64.AppImage` for 2.6.3) does not count.
 */
export function isAppImageOf(fileName, version) {
  const marker = `-${version}-`
  const at = fileName.indexOf(marker)
  if (at <= 0 || !fileName.endsWith('.AppImage')) return false
  return !fileName.slice(at + marker.length, -'.AppImage'.length).includes('-')
}

/**
 * The update information for one AppImage: the file name with its version replaced by `*`, so it
 * keeps matching the AppImage of the same architecture in later releases.
 * `Vicu-2.6.3-x86_64.AppImage` -> `gh-releases-zsync|rendyhd|Vicu|latest|Vicu-*-x86_64.AppImage.zsync`
 */
export function updateInformation(fileName, version, channel = 'latest') {
  if (!isAppImageOf(fileName, version)) {
    throw new Error(`${fileName} is not named <name>-${version}-<arch>.AppImage`)
  }
  if (!UPDATE_CHANNELS.includes(channel)) {
    throw new Error(`unknown channel ${channel} (${UPDATE_CHANNELS.join(' or ')})`)
  }
  const pattern = fileName.replace(`-${version}-`, '-*-')
  return `gh-releases-zsync|${RELEASES_REPO.owner}|${RELEASES_REPO.repo}|${channel}|${pattern}.zsync`
}

/**
 * Where a section lives in an ELF file, from its section headers. `read(position, length)` returns
 * the bytes at that position, so the whole AppImage never has to be in memory. Only little-endian
 * ELF64, the format of every AppImage Vicu ships (x86_64 and arm64).
 */
export function findElfSection(read, name) {
  const ident = read(0, 64)
  if (ident.readUInt32BE(0) !== 0x7f454c46) throw new Error('not an ELF file')
  if (ident[4] !== 2 || ident[5] !== 1) throw new Error('expected a little-endian ELF64 file')
  const u64 = (b, o) => Number(b.readBigUInt64LE(o))

  const shoff = u64(ident, 0x28)
  const shentsize = ident.readUInt16LE(0x3a)
  const shnum = ident.readUInt16LE(0x3c)
  const shstrndx = ident.readUInt16LE(0x3e)
  if (!shoff || !shnum) throw new Error('the ELF file has no section headers')

  const headers = read(shoff, shentsize * shnum)
  const section = (i) => {
    const o = i * shentsize
    return { nameOffset: headers.readUInt32LE(o), offset: u64(headers, o + 0x18), size: u64(headers, o + 0x20) }
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
    if (i === -1) return undefined
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`)
    return value
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const dir = resolve(arg('--dir') ?? join(root, 'dist'))
  const optional = argv.includes('--optional')
  const channel = arg('--channel') ?? 'latest'
  const tag = arg('--upload')
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

  // Only this version's AppImages: dist/ can still hold older builds.
  const appImages = existsSync(dir)
    ? readdirSync(dir).filter((f) => isAppImageOf(f, version))
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
    const info = updateInformation(name, version, channel)
    writeUpdateInformation(file, info)
    console.log(`${name}: ${info}`)
    uploads.push(file)
    if (zsync) {
      // -u is relative, so the .zsync resolves the AppImage next to itself on the release.
      execFileSync('zsyncmake', ['-u', name, '-o', `${name}.zsync`, name], { cwd: dir, stdio: 'inherit' })
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
