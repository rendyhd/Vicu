import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findElfSection, updateInformation, writeUpdateInformation } from '../appimage-update-info.mjs'

/** A minimal little-endian ELF64 file with a null section, `.upd_info` (`size` bytes) and `.shstrtab`. */
function elfWithUpdInfo(size) {
  const names = Buffer.from('\0.upd_info\0.shstrtab\0', 'latin1')
  const updOffset = 64
  const namesOffset = updOffset + size
  const shoff = namesOffset + names.length
  const file = Buffer.alloc(shoff + 3 * 64)
  file.writeUInt32BE(0x7f454c46, 0)
  file[4] = 2 // 64-bit
  file[5] = 1 // little-endian
  file.writeBigUInt64LE(BigInt(shoff), 0x28)
  file.writeUInt16LE(64, 0x3a)
  file.writeUInt16LE(3, 0x3c)
  file.writeUInt16LE(2, 0x3e)
  names.copy(file, namesOffset)
  const header = (i, nameOffset, offset, length) => {
    const o = shoff + i * 64
    file.writeUInt32LE(nameOffset, o)
    file.writeBigUInt64LE(BigInt(offset), o + 0x18)
    file.writeBigUInt64LE(BigInt(length), o + 0x20)
  }
  header(1, 1, updOffset, size)
  header(2, 11, namesOffset, names.length)
  return { file, updOffset }
}

describe('updateInformation', () => {
  it('points each architecture at its own AppImage on the GitHub releases', () => {
    expect(updateInformation('Vicu-2.6.3-x86_64.AppImage', '2.6.3')).toBe(
      'gh-releases-zsync|rendyhd|Vicu|latest|Vicu-*-x86_64.AppImage.zsync',
    )
    expect(updateInformation('Vicu-2.7.0-beta.1-arm64.AppImage', '2.7.0-beta.1')).toBe(
      'gh-releases-zsync|rendyhd|Vicu|latest|Vicu-*-arm64.AppImage.zsync',
    )
  })

  it('refuses a file that does not carry the version', () => {
    expect(() => updateInformation('Vicu-2.6.2-x86_64.AppImage', '2.6.3')).toThrow()
    expect(() => updateInformation('Vicu-2.6.3-x86_64.dmg', '2.6.3')).toThrow()
  })
})

describe('writeUpdateInformation', () => {
  let dir
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

  it('fills .upd_info zero-padded and leaves every other byte alone', () => {
    const { file, updOffset } = elfWithUpdInfo(64)
    file.fill(0xaa, updOffset, updOffset + 64) // old contents must not survive
    dir = mkdtempSync(join(tmpdir(), 'vicu-appimage-'))
    const path = join(dir, 'Vicu-1.0.0-x86_64.AppImage')
    writeFileSync(path, file)

    writeUpdateInformation(path, 'gh-releases-zsync|a|b|latest|x.zsync')

    const after = readFileSync(path)
    const read = (position, length) => after.subarray(position, position + length)
    expect(findElfSection(read, '.upd_info')).toEqual({ offset: updOffset, size: 64 })
    const section = after.subarray(updOffset, updOffset + 64)
    expect(section.toString('utf8').replace(/\0+$/, '')).toBe('gh-releases-zsync|a|b|latest|x.zsync')
    expect(after.subarray(0, updOffset)).toEqual(file.subarray(0, updOffset))
    expect(after.subarray(updOffset + 64)).toEqual(file.subarray(updOffset + 64))
  })

  it('fails when the information does not fit', () => {
    const { file } = elfWithUpdInfo(8)
    dir = mkdtempSync(join(tmpdir(), 'vicu-appimage-'))
    const path = join(dir, 'a.AppImage')
    writeFileSync(path, file)
    expect(() => writeUpdateInformation(path, 'far too long for eight bytes')).toThrow(/holds 7/)
  })
})
