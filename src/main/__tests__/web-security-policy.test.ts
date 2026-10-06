import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'
import {
  decideNavigation,
  isAppUrl,
  isExternalAllowed,
  isTrustedSender,
  type AppOrigin,
} from '../web-security-policy'

const rendererDir = join(tmpdir(), 'vicu-app', 'out', 'renderer')
const rendererDirUrl = `${pathToFileURL(rendererDir).href}/`
const pageUrl = (rel: string): string => pathToFileURL(join(rendererDir, rel)).href

const prod: AppOrigin = { rendererDir }
const dev: AppOrigin = { devServerUrl: 'http://localhost:5173' }

describe('isAppUrl (production)', () => {
  it('accepts the main window, Quick Entry and Quick View pages', () => {
    expect(isAppUrl(pageUrl('index.html'), prod)).toBe(true)
    expect(isAppUrl(`${pageUrl('index.html')}#/inbox`, prod)).toBe(true)
    expect(isAppUrl(pageUrl(join('quick-entry', 'index.html')), prod)).toBe(true)
    expect(isAppUrl(pageUrl(join('quick-view', 'index.html')), prod)).toBe(true)
  })

  it('rejects files outside the renderer directory', () => {
    expect(isAppUrl(pathToFileURL(join(tmpdir(), 'vicu-app', 'out', 'main', 'index.js')).href, prod)).toBe(false)
    expect(isAppUrl(pathToFileURL(join(tmpdir(), 'dropped.html')).href, prod)).toBe(false)
    // Sibling directory that merely shares the prefix.
    expect(isAppUrl(pathToFileURL(`${rendererDir}-evil`).href + '/index.html', prod)).toBe(false)
  })

  it('does not let dot segments or encoded separators escape the directory', () => {
    expect(isAppUrl(`${rendererDirUrl}../main/index.js`, prod)).toBe(false)
    expect(isAppUrl(`${rendererDirUrl}%2e%2e/main/index.js`, prod)).toBe(false)
    expect(isAppUrl(`${rendererDirUrl}..%2fmain/index.js`, prod)).toBe(false)
    expect(isAppUrl(`${rendererDirUrl}..%5cmain/index.js`, prod)).toBe(false)
  })

  it('rejects remote and non-file schemes', () => {
    expect(isAppUrl('https://example.com/', prod)).toBe(false)
    expect(isAppUrl('http://localhost:5173/', prod)).toBe(false)
    expect(isAppUrl('javascript:alert(1)', prod)).toBe(false)
    expect(isAppUrl('data:text/html,<h1>x</h1>', prod)).toBe(false)
    expect(isAppUrl('about:blank', prod)).toBe(false)
  })

  it('trusts the app however its install path is percent-encoded', () => {
    const dir = join(tmpdir(), 'Vicu App [1] #2 100% René', 'out', 'renderer')
    const origin: AppOrigin = { rendererDir: dir }
    expect(isAppUrl(pathToFileURL(join(dir, 'index.html')).href, origin)).toBe(true)
    expect(isAppUrl(pathToFileURL(join(dir, 'quick-view', 'index.html')).href, origin)).toBe(true)
    // Chromium may encode a character Node leaves alone, or the reverse.
    const hand = pathToFileURL(join(dir, 'index.html')).href.replace('Ren%C3%A9', 'René')
    expect(isAppUrl(hand, origin)).toBe(true)
  })

  it('handles Windows paths: drive letter, backslashes, spaces, case', () => {
    const origin: AppOrigin = {
      rendererDir: 'C:\\Program Files\\Vicu\\resources\\app.asar\\out\\renderer',
      caseInsensitivePaths: true,
    }
    const base = 'file:///C:/Program%20Files/Vicu/resources/app.asar/out/renderer'
    expect(isAppUrl(`${base}/index.html`, origin)).toBe(true)
    expect(isAppUrl(`${base}/quick-entry/index.html#/x`, origin)).toBe(true)
    expect(isAppUrl('file:///c:/program%20files/vicu/resources/app.asar/out/renderer/index.html', origin)).toBe(true)
    expect(isAppUrl('file:///C:/Program%20Files/Vicu/resources/app.asar/out/main/index.js', origin)).toBe(false)
    expect(isAppUrl('file:///C:/Program%20Files/Vicu/resources/app.asar/out/renderer-evil/index.html', origin)).toBe(false)
    expect(isAppUrl('file:///D:/Program%20Files/Vicu/resources/app.asar/out/renderer/index.html', origin)).toBe(false)
  })

  it('handles POSIX paths', () => {
    const origin: AppOrigin = { rendererDir: '/Applications/Vicu.app/Contents/Resources/app.asar/out/renderer' }
    expect(isAppUrl('file:///Applications/Vicu.app/Contents/Resources/app.asar/out/renderer/index.html', origin)).toBe(true)
    expect(isAppUrl('file:///Applications/Vicu.app/Contents/Resources/app.asar/out/main/index.js', origin)).toBe(false)
    expect(isAppUrl('file:///etc/passwd', origin)).toBe(false)
  })

  it('rejects file URLs that carry a host (UNC shares)', () => {
    expect(isAppUrl('file://server/share/out/renderer/index.html', prod)).toBe(false)
  })

  it('rejects garbage input', () => {
    expect(isAppUrl('', prod)).toBe(false)
    expect(isAppUrl('not a url', prod)).toBe(false)
    expect(isAppUrl(undefined, prod)).toBe(false)
    expect(isAppUrl(null, prod)).toBe(false)
  })

  it('rejects everything when no origin is configured', () => {
    expect(isAppUrl(pageUrl('index.html'), {})).toBe(false)
  })

  it('can compare paths case-insensitively', () => {
    const upper = pageUrl('index.html').replace(/vicu-app/, 'VICU-APP')
    expect(isAppUrl(upper, { rendererDir, caseInsensitivePaths: true })).toBe(true)
    expect(isAppUrl(upper, { rendererDir, caseInsensitivePaths: false })).toBe(false)
  })
})

describe('isAppUrl (development)', () => {
  it('accepts only the dev server origin', () => {
    expect(isAppUrl('http://localhost:5173/', dev)).toBe(true)
    expect(isAppUrl('http://localhost:5173/quick-entry/index.html', dev)).toBe(true)
    expect(isAppUrl('http://localhost:5173/#/today', dev)).toBe(true)
  })

  it('rejects other hosts, ports and schemes', () => {
    expect(isAppUrl('http://localhost:5174/', dev)).toBe(false)
    expect(isAppUrl('http://evil.example/', dev)).toBe(false)
    expect(isAppUrl('http://localhost:5173.evil.example/', dev)).toBe(false)
    expect(isAppUrl('https://localhost:5173/', dev)).toBe(false)
    expect(isAppUrl(pageUrl('index.html'), dev)).toBe(false)
  })
})

describe('isExternalAllowed', () => {
  it('allows web, mail and Obsidian links', () => {
    expect(isExternalAllowed('https://vikunja.io/docs')).toBe(true)
    expect(isExternalAllowed('http://example.com')).toBe(true)
    expect(isExternalAllowed('mailto:someone@example.com')).toBe(true)
    expect(isExternalAllowed('obsidian://open?vault=Notes&file=Inbox')).toBe(true)
  })

  it('drops schemes that can run local code or read local files', () => {
    expect(isExternalAllowed('file:///C:/Windows/System32/calc.exe')).toBe(false)
    expect(isExternalAllowed('javascript:alert(1)')).toBe(false)
    expect(isExternalAllowed('data:text/html,hi')).toBe(false)
    expect(isExternalAllowed('ms-msdt:/id PCWDiagnostic')).toBe(false)
    expect(isExternalAllowed('vscode://file/C:/x')).toBe(false)
    expect(isExternalAllowed('ftp://example.com/')).toBe(false)
  })

  it('drops garbage input', () => {
    expect(isExternalAllowed('')).toBe(false)
    expect(isExternalAllowed('example.com')).toBe(false)
    expect(isExternalAllowed(42)).toBe(false)
    expect(isExternalAllowed(undefined)).toBe(false)
  })
})

describe('decideNavigation', () => {
  it('lets app pages through', () => {
    expect(decideNavigation(`${pageUrl('index.html')}#/settings`, prod)).toBe('allow')
    expect(decideNavigation('http://localhost:5173/#/inbox', dev)).toBe('allow')
  })

  it('hands allowlisted external links to the OS', () => {
    expect(decideNavigation('https://example.com/page', prod)).toBe('external')
    expect(decideNavigation('mailto:a@b.c', prod)).toBe('external')
  })

  it('blocks dropped files and unknown schemes', () => {
    expect(decideNavigation(pathToFileURL(join(tmpdir(), 'dropped.html')).href, prod)).toBe('block')
    expect(decideNavigation('javascript:void(0)', prod)).toBe('block')
    expect(decideNavigation('blob:https://example.com/abc', prod)).toBe('block')
  })
})

describe('isTrustedSender', () => {
  it('trusts a top-level app frame', () => {
    expect(isTrustedSender({ senderFrame: { url: pageUrl('index.html') } }, prod)).toBe(true)
    expect(isTrustedSender({ senderFrame: { url: pageUrl(join('quick-entry', 'index.html')) } }, prod)).toBe(true)
    expect(isTrustedSender({ senderFrame: { url: 'http://localhost:5173/#/inbox', parent: null } }, dev)).toBe(true)
  })

  it('rejects a missing or destroyed frame', () => {
    expect(isTrustedSender({ senderFrame: null }, prod)).toBe(false)
    expect(isTrustedSender({}, prod)).toBe(false)
    expect(isTrustedSender(null, prod)).toBe(false)
    expect(isTrustedSender(undefined, prod)).toBe(false)
  })

  it('rejects frames that are not app pages', () => {
    expect(isTrustedSender({ senderFrame: { url: 'https://example.com/' } }, prod)).toBe(false)
    expect(isTrustedSender({ senderFrame: { url: pathToFileURL(join(tmpdir(), 'x.html')).href } }, prod)).toBe(false)
  })

  it('rejects subframes even when they show an app URL', () => {
    expect(isTrustedSender({ senderFrame: { url: pageUrl('index.html'), parent: {} } }, prod)).toBe(false)
  })
})
