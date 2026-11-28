import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' }, safeStorage: {} }))

import { parseCalendarStore, takeColor, emptyStore } from '../calendar/store'
import { isPlainSecret, openSecret, sealSecret, secretStorageLevel, setSafeStorageForTests } from '../safe-storage'

describe('the calendar store', () => {
  it('moves the proof of concept\'s links (version 1) into connections, keeping ids and choices', () => {
    const state = parseCalendarStore({
      feeds: [
        { id: 'f1', name: 'Work', color: '#0a84ff', enabled: true, busyOnly: true, countsAsBusy: false, url: 'sealed-1' },
        { id: 'f2', name: '', color: 'red', url: 'sealed-2' },
        { id: 3, url: 'broken' },
      ],
    })
    expect(state.version).toBe(2)
    expect(state.colorIndex).toBe(2)
    expect(state.connections).toEqual([
      {
        id: 'f1', kind: 'ics', name: 'Work', sealed: 'sealed-1',
        calendars: [{ id: 'f1', remoteId: 'feed', name: 'Work', color: '#0a84ff', enabled: true, busyOnly: true, countsAsBusy: false }],
      },
      {
        id: 'f2', kind: 'ics', name: 'Calendar', sealed: 'sealed-2',
        calendars: [{ id: 'f2', remoteId: 'feed', name: 'Calendar', color: '#7c6cf2', enabled: true, busyOnly: false, countsAsBusy: true }],
      },
    ])
  })

  it('reads version 2 and drops what it does not know', () => {
    const state = parseCalendarStore({
      version: 2,
      colorIndex: 7,
      connections: [
        { id: 'a', kind: 'caldav', name: 'iCloud', sealed: 's', calendars: [{ id: 'c1', remoteId: 'r1', name: 'Home', color: '#30a46c' }, { id: 'c2' }] },
        { id: 'b', kind: 'exchange', name: 'x', sealed: 's', calendars: [] },
      ],
    })
    expect(state.colorIndex).toBe(7)
    expect(state.connections.map((c) => [c.id, c.calendars.map((cal) => cal.id)])).toEqual([['a', ['c1']]])
    expect(() => parseCalendarStore(null)).toThrow()
  })

  it('gives colours in the order calendars were added, also after removals (20.9)', () => {
    let state = emptyStore()
    const colors: string[] = []
    for (let i = 0; i < 7; i++) {
      const taken = takeColor(state)
      colors.push(taken.color)
      state = taken.state
    }
    expect(colors).toEqual(['#7c6cf2', '#0a84ff', '#30a46c', '#e5484d', '#f76b15', '#12a594', '#7c6cf2'])
  })
})

describe('safeStorage across Electron versions', () => {
  afterEach(() => setSafeStorageForTests(null))

  const xor = (text: string) => Buffer.from(Buffer.from(text, 'utf8').map((b) => b ^ 0x5a))
  const unxor = (buffer: Buffer) => Buffer.from(buffer.map((b) => b ^ 0x5a)).toString('utf8')

  it('uses the asynchronous encryptor when Electron has it (45 and later)', async () => {
    const sync = vi.fn()
    setSafeStorageForTests({
      isEncryptionAvailable: sync,
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (text) => xor(text),
      decryptStringAsync: async (buffer) => ({ result: unxor(buffer), shouldReEncrypt: false }),
    })
    const sealed = await sealSecret('https://example.com/secret.ics')
    expect(sealed.startsWith('a1:')).toBe(true)
    expect(sealed).not.toContain('secret')
    expect(await openSecret(sealed)).toBe('https://example.com/secret.ics')
    expect(sync).not.toHaveBeenCalled()
  })

  it('falls back to the synchronous calls, and reads their older values with either', async () => {
    setSafeStorageForTests({ isEncryptionAvailable: () => true, encryptString: (text) => xor(text), decryptString: (buffer) => unxor(buffer) })
    const legacy = await sealSecret('pw')
    expect(legacy.startsWith('a1:') || legacy.startsWith('plain:')).toBe(false)
    expect(await openSecret(legacy)).toBe('pw')
    // Electron 46: only the asynchronous decryptor is left; it reads the older format.
    setSafeStorageForTests({ isAsyncEncryptionAvailable: async () => true, decryptStringAsync: async (buffer) => ({ result: unxor(buffer) }) })
    expect(await openSecret(legacy)).toBe('pw')
  })

  it('keeps a plain value where there is no encryption, and says so', async () => {
    setSafeStorageForTests({ isEncryptionAvailable: () => false })
    const sealed = await sealSecret('pw')
    expect(sealed).toBe('plain:pw')
    expect(isPlainSecret(sealed)).toBe(true)
    expect(await secretStorageLevel(true, 'win32')).toBe('plaintext')
  })

  it('says links are only obscured on Linux without a keyring', async () => {
    setSafeStorageForTests({ isAsyncEncryptionAvailable: async () => true, getSelectedStorageBackend: () => 'basic_text' })
    expect(await secretStorageLevel(false, 'linux')).toBe('obfuscated')
    setSafeStorageForTests({ isAsyncEncryptionAvailable: async () => true, getSelectedStorageBackend: () => 'gnome_libsecret' })
    expect(await secretStorageLevel(false, 'linux')).toBe('encrypted')
  })

  it('answers null for a value it cannot decrypt', async () => {
    setSafeStorageForTests({ decryptString: () => { throw new Error('bad') } })
    expect(await openSecret('Zm9v')).toBeNull()
  })
})
