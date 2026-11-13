// The browser link's native-messaging host, driven the way a browser drives it: frames on stdin
// (a 4-byte little-endian length, then UTF-8 JSON), nothing read back, and the context file the app
// reads (browser-client.ts) as the only result.
//
// The same cases run against both hosts, so they cannot drift apart:
//   - resources/native-messaging-host/vicu-bridge.js, which Windows and Linux run with the app
//     binary as Node (here: with the Node that runs the tests), on every system;
//   - resources/bridge/vicu-bridge-macos, the signed tool macOS uses (native/bridge-macos), on a
//     Mac where `npm run bridge:helper` has built it. CI builds it before the tests.

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..', '..', '..')
const SCRIPT = join(ROOT, 'resources', 'native-messaging-host', 'vicu-bridge.js')
const HELPER = join(ROOT, 'resources', 'bridge', 'vicu-bridge-macos')

interface Host {
  /** Starts the host with its context file somewhere under `dir`. */
  start(dir: string): ChildProcessWithoutNullStreams
  /** Where that host writes the context file. */
  contextFile(dir: string): string
}

/** vicu-bridge.js finds the profile through the variables each system uses for it. */
const scriptHost: Host = {
  start: (dir) =>
    spawn(process.execPath, [SCRIPT], {
      env: { ...process.env, APPDATA: dir, XDG_CONFIG_HOME: dir, HOME: dir, USERPROFILE: dir },
    }),
  contextFile: (dir) =>
    process.platform === 'darwin'
      ? join(dir, 'Library', 'Application Support', 'vicu', 'browser-context.json')
      : join(dir, 'vicu', 'browser-context.json'),
}

/** The macOS tool honours the app's own throwaway-profile variable. */
const helperHost: Host = {
  start: (dir) => spawn(HELPER, ['chrome-extension://abcdefghijklmnopabcdefghijklmnop/'], {
    env: { ...process.env, VICU_USER_DATA_DIR: join(dir, 'profile') },
  }),
  contextFile: (dir) => join(dir, 'profile', 'browser-context.json'),
}

function frame(message: unknown): Buffer {
  return rawFrame(Buffer.from(typeof message === 'string' ? message : JSON.stringify(message), 'utf-8'))
}

function rawFrame(body: Buffer): Buffer {
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length, 0)
  return Buffer.concat([header, body])
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

async function waitFor<T>(read: () => T | undefined, what: string): Promise<T> {
  const until = Date.now() + 10_000
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`)
    await sleep(15)
  }
}

interface Context { url?: unknown; title?: unknown; timestamp?: unknown }

function protocolSuite(host: Host, extras: { oversizedFrames: boolean }): void {
  let dir = ''
  let child: ChildProcessWithoutNullStreams | null = null
  let stdout: Buffer[] = []
  let exited: Promise<number | null> = Promise.resolve(null)

  const file = (): string => host.contextFile(dir)
  const read = (): Context | undefined => {
    try { return JSON.parse(readFileSync(file(), 'utf-8')) as Context } catch { return undefined }
  }
  const contextWithUrl = (url: string): Promise<Context> =>
    waitFor(() => { const c = read(); return c?.url === url ? c : undefined }, `the context for ${url}`)
  const noContext = (): Promise<true> => waitFor(() => (existsSync(file()) ? undefined : true), 'the context to be deleted')
  const send = (data: Buffer): void => { child!.stdin.write(data) }
  const closeStdin = (): Promise<number | null> => { child!.stdin.end(); return exited }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vicu-bridge-'))
    stdout = []
    child = host.start(dir)
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stdin.on('error', () => { /* the host went away first */ })
    const started = child
    exited = new Promise((done) => started.once('exit', (code) => done(code)))
  })

  afterEach(async () => {
    if (child && child.exitCode === null) {
      child.kill()
      await exited
    }
    child = null
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes the tab as url, title and a timestamp in milliseconds', async () => {
    const before = Date.now()
    send(frame({ type: 'tab', url: 'https://example.com/a?b=1#c', title: 'An example' }))
    const context = await contextWithUrl('https://example.com/a?b=1#c')
    expect(Object.keys(context).sort()).toEqual(['timestamp', 'title', 'url'])
    expect(context.title).toBe('An example')
    expect(typeof context.timestamp).toBe('number')
    expect(Number.isInteger(context.timestamp)).toBe(true)
    expect(context.timestamp as number).toBeGreaterThanOrEqual(before - 1000)
    expect(context.timestamp as number).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('writes an empty title when the tab has none', async () => {
    send(frame({ type: 'tab', url: 'https://example.com/untitled' }))
    expect((await contextWithUrl('https://example.com/untitled')).title).toBe('')
  })

  it('keeps text outside ASCII, and quotes and slashes, as they were sent', async () => {
    const title = 'Añadir "tarea" \\ 日本語 𠮷'
    send(frame({ type: 'tab', url: 'https://example.com/ü/𠮷', title }))
    const context = await contextWithUrl('https://example.com/ü/𠮷')
    expect(context.title).toBe(title)
  })

  it('reads several frames that arrive in one write, in order', async () => {
    send(Buffer.concat([
      frame({ type: 'tab', url: 'https://example.com/1', title: 'One' }),
      frame({ type: 'tab', url: 'https://example.com/2', title: 'Two' }),
      frame({ type: 'tab', url: 'https://example.com/3', title: 'Three' }),
    ]))
    expect((await contextWithUrl('https://example.com/3')).title).toBe('Three')
  })

  it('reads a frame that arrives a few bytes at a time', async () => {
    const data = frame({ type: 'tab', url: 'https://example.com/slow', title: 'Slow' })
    for (let i = 0; i < data.length; i += 3) {
      send(data.subarray(i, i + 3))
      if (i % 12 === 0) await sleep(2)
    }
    expect((await contextWithUrl('https://example.com/slow')).title).toBe('Slow')
  })

  it('deletes the context on a clear message', async () => {
    send(frame({ type: 'tab', url: 'https://example.com/shown', title: 'Shown' }))
    await contextWithUrl('https://example.com/shown')
    send(frame({ type: 'clear' }))
    await noContext()
  })

  it('ignores frames it cannot use and goes on with the next one', async () => {
    send(frame({ type: 'tab', url: 'https://example.com/kept', title: 'Kept' }))
    const kept = await contextWithUrl('https://example.com/kept')
    send(Buffer.concat([
      frame('{ this is not JSON'),
      frame('null'),
      frame('[1, 2, 3]'),
      frame('"tab"'),
      frame({ type: 'tab' }),
      frame({ type: 'tab', url: '' }),
      frame({ type: 'something-else', url: 'https://example.com/other' }),
      frame({ url: 'https://example.com/no-type' }),
      rawFrame(Buffer.alloc(0)),
    ]))
    await sleep(200)
    expect(read()).toEqual(kept)
    send(frame({ type: 'tab', url: 'https://example.com/after', title: 'After' }))
    expect((await contextWithUrl('https://example.com/after')).title).toBe('After')
  })

  it('deletes the context and exits 0 when the browser closes the pipe, having written nothing to stdout', async () => {
    send(frame({ type: 'tab', url: 'https://example.com/open', title: 'Open' }))
    await contextWithUrl('https://example.com/open')
    expect(await closeStdin()).toBe(0)
    expect(existsSync(file())).toBe(false)
    expect(Buffer.concat(stdout).length).toBe(0)
  })

  it('exits 0 when the pipe closes in the middle of a frame', async () => {
    send(frame({ type: 'tab', url: 'https://example.com/half', title: 'Half' }).subarray(0, 9))
    expect(await closeStdin()).toBe(0)
    expect(existsSync(file())).toBe(false)
  })

  it.runIf(extras.oversizedFrames)('skips a frame over 1 MB, clears the context, and reads the frame after it', async () => {
    send(frame({ type: 'tab', url: 'https://example.com/before', title: 'Before' }))
    await contextWithUrl('https://example.com/before')
    const huge = frame({ type: 'tab', url: `data:text/plain,${'x'.repeat(2 * 1024 * 1024)}`, title: 'Huge' })
    send(huge.subarray(0, 4096))
    await noContext()
    send(huge.subarray(4096))
    send(frame({ type: 'tab', url: 'https://example.com/next', title: 'Next' }))
    expect((await contextWithUrl('https://example.com/next')).title).toBe('Next')
  })
}

describe('vicu-bridge.js (Windows and Linux host)', () => {
  protocolSuite(scriptHost, { oversizedFrames: false })
})

// Only where the tool exists: a Mac after `npm run bridge:helper`.
describe.skipIf(process.platform !== 'darwin' || !existsSync(HELPER))('vicu-bridge-macos (macOS host)', () => {
  protocolSuite(helperHost, { oversizedFrames: true })
})
