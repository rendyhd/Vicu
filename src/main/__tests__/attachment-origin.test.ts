import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  XATTR_PATH,
  markFromInternet,
  originOf,
  quarantineXattrArgs,
  zoneIdentifierContent,
  zoneIdentifierPath,
} from '../attachment-origin'

describe('zoneIdentifierContent', () => {
  it('is the Internet zone with the server origin', () => {
    expect(zoneIdentifierContent('https://tasks.example.com/api/v1/')).toBe(
      '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://tasks.example.com\r\n'
    )
  })

  it('leaves the host out when there is no usable server address', () => {
    for (const url of [undefined, '', 'not a url', 'file:///C:/x', 42]) {
      expect(zoneIdentifierContent(url)).toBe('[ZoneTransfer]\r\nZoneId=3\r\n')
    }
  })

  it('never puts a path, user or query of the address in the stream', () => {
    expect(originOf('http://user:secret@host:3456/vikunja?token=x')).toBe('http://host:3456')
  })

  it('names the alternate data stream', () => {
    expect(zoneIdentifierPath('C:\\Temp\\a.exe')).toBe('C:\\Temp\\a.exe:Zone.Identifier')
  })
})

describe('quarantineXattrArgs', () => {
  it('writes the quarantine value with the time in hex seconds', () => {
    expect(quarantineXattrArgs('/Users/me/Downloads/a b.zip', 0x65000000 * 1000 + 999)).toEqual([
      '-w', 'com.apple.quarantine', '0083;65000000;Vicu;', '/Users/me/Downloads/a b.zip',
    ])
  })
})

describe('markFromInternet', () => {
  it('writes the stream on Windows', async () => {
    const writeFile = vi.fn(async () => undefined)
    const execFile = vi.fn(async () => undefined)
    await markFromInternet('C:\\x\\a.doc', 'https://h.example', { platform: 'win32', writeFile, execFile })
    expect(writeFile).toHaveBeenCalledWith('C:\\x\\a.doc:Zone.Identifier', zoneIdentifierContent('https://h.example'))
    expect(execFile).not.toHaveBeenCalled()
  })

  it('runs xattr with an argument list on macOS', async () => {
    const writeFile = vi.fn(async () => undefined)
    const execFile = vi.fn(async () => undefined)
    await markFromInternet('/tmp/a.zip', undefined, { platform: 'darwin', now: () => 16_000, writeFile, execFile })
    expect(execFile).toHaveBeenCalledWith(XATTR_PATH, quarantineXattrArgs('/tmp/a.zip', 16_000))
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('does nothing on Linux', async () => {
    const writeFile = vi.fn(async () => undefined)
    const execFile = vi.fn(async () => undefined)
    await markFromInternet('/tmp/a', undefined, { platform: 'linux', writeFile, execFile })
    expect(writeFile).not.toHaveBeenCalled()
    expect(execFile).not.toHaveBeenCalled()
  })

  it('ignores a failure', async () => {
    await expect(markFromInternet('C:\\x', undefined, {
      platform: 'win32',
      writeFile: async () => { throw new Error('ENOTSUP') },
    })).resolves.toBeUndefined()
    await expect(markFromInternet('/x', undefined, {
      platform: 'darwin',
      execFile: async () => { throw new Error('ENOENT') },
    })).resolves.toBeUndefined()
  })
})

describe.skipIf(process.platform !== 'win32')('markFromInternet on a real NTFS file', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'vicu-motw-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('gives the file a readable Zone.Identifier stream and leaves its bytes alone', async () => {
    const file = join(dir, 'report.doc')
    writeFileSync(file, 'bytes')
    await markFromInternet(file, 'https://tasks.example.com')
    expect(readFileSync(`${file}:Zone.Identifier`, 'utf8')).toBe(
      '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://tasks.example.com\r\n'
    )
    expect(readFileSync(file, 'utf8')).toBe('bytes')
  })
})
