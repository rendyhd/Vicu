import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { EventEmitter } from 'events'
import { join } from 'path'
import { pathToFileURL } from 'url'

const mocks = vi.hoisted(() => ({
  appHandlers: new Map<string, (...args: any[]) => void>(),
  openExternal: undefined as unknown as Mock<(...args: any[]) => any>,
  authSession: { name: 'oidc-auth' },
}))

vi.mock('electron', () => ({
  app: {
    on: (event: string, handler: (...args: any[]) => void) => {
      mocks.appHandlers.set(event, handler)
    },
  },
  session: { fromPartition: () => mocks.authSession },
  shell: { openExternal: (...args: unknown[]) => mocks.openExternal(...args) },
}))

// The packaged renderer directory resolves relative to the module: src/renderer in tests.
const rendererFile = (rel: string): string => pathToFileURL(join(__dirname, '..', '..', 'renderer', rel)).href

class FakeContents extends EventEmitter {
  session: unknown = { name: 'default' }
  windowOpenHandler: ((details: { url: string }) => { action: string }) | null = null
  setWindowOpenHandler(handler: (details: { url: string }) => { action: string }): void {
    this.windowOpenHandler = handler
  }
  navigate(url: string, event = { prevented: false, preventDefault() { this.prevented = true } }) {
    this.emit('will-navigate', event, url)
    return event
  }
  redirect(url: string, event = { prevented: false, preventDefault() { this.prevented = true } }) {
    this.emit('will-redirect', event, url)
    return event
  }
}

async function setup(env: { devUrl?: string } = {}) {
  vi.resetModules()
  mocks.appHandlers.clear()
  mocks.openExternal = vi.fn(async () => {})
  if (env.devUrl) process.env.ELECTRON_RENDERER_URL = env.devUrl
  else delete process.env.ELECTRON_RENDERER_URL
  const mod = await import('../web-security')
  mod.registerWebSecurity()
  const created = mocks.appHandlers.get('web-contents-created')!
  const attach = (contents: FakeContents): FakeContents => {
    created({}, contents)
    return contents
  }
  return { mod, attach }
}

describe('web security guards (production layout)', () => {
  const savedEnv = process.env.ELECTRON_RENDERER_URL

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.ELECTRON_RENDERER_URL
    else process.env.ELECTRON_RENDERER_URL = savedEnv
  })

  it('registers once on web-contents-created', async () => {
    const { mod } = await setup()
    mod.registerWebSecurity()
    expect(mocks.appHandlers.has('web-contents-created')).toBe(true)
  })

  it('lets app pages navigate (hash routes, Quick Entry, Quick View)', async () => {
    const { attach } = await setup()
    const c = attach(new FakeContents())
    expect(c.navigate(`${rendererFile('index.html')}#/today`).prevented).toBe(false)
    expect(c.navigate(rendererFile('quick-entry/index.html')).prevented).toBe(false)
    expect(c.navigate(rendererFile('quick-view/index.html')).prevented).toBe(false)
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('blocks a dropped file or foreign page and does not open it', async () => {
    const { attach } = await setup()
    const c = attach(new FakeContents())
    const dropped = c.navigate(pathToFileURL(join(__dirname, 'dropped.html')).href)
    expect(dropped.prevented).toBe(true)
    expect(c.navigate('javascript:alert(1)').prevented).toBe(true)
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('blocks web navigation and opens it in the system browser instead', async () => {
    const { attach } = await setup()
    const c = attach(new FakeContents())
    expect(c.navigate('https://example.com/page').prevented).toBe(true)
    expect(c.navigate('mailto:a@b.c').prevented).toBe(true)
    expect(mocks.openExternal).toHaveBeenCalledWith('https://example.com/page')
    expect(mocks.openExternal).toHaveBeenCalledWith('mailto:a@b.c')
  })

  it('refuses redirects away from the app', async () => {
    const { attach } = await setup()
    const c = attach(new FakeContents())
    expect(c.redirect('https://example.com/').prevented).toBe(true)
    expect(c.redirect(rendererFile('index.html')).prevented).toBe(false)
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('denies every new window, opening allowlisted links externally', async () => {
    const { attach } = await setup()
    const c = attach(new FakeContents())
    const open = (url: string) => c.windowOpenHandler!({ url })

    expect(open('https://example.com/').action).toBe('deny')
    expect(open('obsidian://open?vault=V').action).toBe('deny')
    expect(open('mailto:a@b.c').action).toBe('deny')
    expect(open('file:///C:/Windows/System32/calc.exe').action).toBe('deny')
    expect(open('javascript:alert(1)').action).toBe('deny')
    expect(open('about:blank').action).toBe('deny')

    expect(mocks.openExternal.mock.calls.map((a: unknown[]) => a[0])).toEqual([
      'https://example.com/',
      'obsidian://open?vault=V',
      'mailto:a@b.c',
    ])
  })

  it('denies <webview> attachment', async () => {
    const { attach } = await setup()
    const c = attach(new FakeContents())
    const event = { prevented: false, preventDefault() { this.prevented = true } }
    c.emit('will-attach-webview', event, {}, {})
    expect(event.prevented).toBe(true)
  })

  it('leaves OIDC sign-in windows free to follow the identity provider, but still denies webviews', async () => {
    const { attach } = await setup()
    const c = new FakeContents()
    c.session = mocks.authSession
    attach(c)

    expect(c.navigate('https://idp.example.com/login').prevented).toBe(false)
    expect(c.windowOpenHandler).toBeNull()
    const event = { prevented: false, preventDefault() { this.prevented = true } }
    c.emit('will-attach-webview', event, {}, {})
    expect(event.prevented).toBe(true)
  })

  it('survives a failing openExternal', async () => {
    const { attach } = await setup()
    mocks.openExternal.mockRejectedValue(new Error('no handler'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const c = attach(new FakeContents())
    expect(() => c.navigate('https://example.com/')).not.toThrow()
    await Promise.resolve()
    vi.restoreAllMocks()
  })
})

describe('web security guards (dev server)', () => {
  const savedEnv = process.env.ELECTRON_RENDERER_URL

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.ELECTRON_RENDERER_URL
    else process.env.ELECTRON_RENDERER_URL = savedEnv
  })

  it('allows only the dev server origin', async () => {
    const { attach } = await setup({ devUrl: 'http://localhost:5173' })
    const c = attach(new FakeContents())
    expect(c.navigate('http://localhost:5173/#/inbox').prevented).toBe(false)
    expect(c.navigate('http://localhost:5173/quick-view/index.html').prevented).toBe(false)
    expect(c.navigate(rendererFile('index.html')).prevented).toBe(true)
    expect(c.navigate('http://localhost:9999/').prevented).toBe(true)
  })
})

describe('IPC sender check', () => {
  const savedEnv = process.env.ELECTRON_RENDERER_URL
  beforeEach(() => {
    delete process.env.ELECTRON_RENDERER_URL
  })
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.ELECTRON_RENDERER_URL
    else process.env.ELECTRON_RENDERER_URL = savedEnv
  })

  it('accepts app pages, including Quick Entry and Quick View', async () => {
    const { mod } = await setup()
    for (const rel of ['index.html', 'quick-entry/index.html', 'quick-view/index.html']) {
      expect(() => mod.assertTrustedSender({ senderFrame: { url: rendererFile(rel), parent: null } })).not.toThrow()
    }
  })

  it('rejects foreign pages, destroyed frames and subframes', async () => {
    const { mod } = await setup()
    expect(() => mod.assertTrustedSender({ senderFrame: { url: 'https://evil.example/' } })).toThrow(/untrusted sender/)
    expect(() => mod.assertTrustedSender({ senderFrame: null })).toThrow(/untrusted sender/)
    expect(() => mod.assertTrustedSender({ senderFrame: { url: rendererFile('index.html'), parent: {} } })).toThrow()
  })

  it('treats a frame whose url getter throws as untrusted', async () => {
    const { mod } = await setup()
    const destroyed = {
      senderFrame: {
        get url(): string {
          throw new Error('Render frame was disposed')
        },
      },
    }
    expect(mod.isTrustedIpcSender(destroyed)).toBe(false)
    expect(() => mod.assertTrustedSender(destroyed)).toThrow(/untrusted sender/)
  })
})
