import { app } from 'electron'
import { execSync } from 'child_process'
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { isMac, isWindows } from './platform'

const HOST_NAME = 'com.vicu.browser'

export interface RegistrationOptions {
  chromeExtensionId: string
  firefoxExtensionId?: string
}

export function getBridgePath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'native-messaging-host', 'vicu-bridge.js')
  }
  return join(app.getAppPath(), 'resources', 'native-messaging-host', 'vicu-bridge.js')
}

function getBatWrapperPath(): string {
  return join(dirname(getBridgePath()), 'vicu-bridge.bat')
}

function ensureBatWrapper(): string {
  const batPath = getBatWrapperPath()
  if (!existsSync(batPath)) {
    const dir = dirname(batPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(batPath, '@echo off\r\nnode "%~dp0\\vicu-bridge.js"\r\n', 'utf-8')
  }
  return batPath
}

function getChromeHostManifestPath(): string {
  // On Windows, the manifest goes in a well-known location
  return join(app.getPath('userData'), `${HOST_NAME}.json`)
}

function getFirefoxHostManifestPath(): string {
  return join(app.getPath('userData'), `${HOST_NAME}.firefox.json`)
}

// --- macOS manifest paths ---
const home = homedir()

function getMacChromeHostDir(): string {
  return join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts')
}

function getMacFirefoxHostDir(): string {
  return join(home, 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts')
}

function getMacEdgeHostDir(): string {
  return join(home, 'Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts')
}

function getMacManifestPath(browserDir: string): string {
  return join(browserDir, `${HOST_NAME}.json`)
}

// macOS GUI apps have PATH = /usr/bin:/bin:/usr/sbin:/sbin which won't find
// node installed via Homebrew, nvm, fnm, etc. Resolve the full path at
// registration time and embed it in a shell wrapper.
// The wrapper lives in userData (NOT inside the .app bundle — that would
// invalidate the code signature).
function ensureShellWrapper(): string {
  const shPath = join(app.getPath('userData'), 'vicu-bridge.sh')
  const bridgeJs = getBridgePath()
  let nodePath = '/usr/bin/env node'
  try {
    const resolved = execSync('which node', { timeout: 3000 }).toString().trim()
    if (resolved) nodePath = resolved
  } catch { /* fallback to env node */ }
  const content = `#!/bin/bash\nexec "${nodePath}" "${bridgeJs}"\n`
  writeFileSync(shPath, content, { mode: 0o755 })
  return shPath
}

export function registerChromeHost(extensionId: string): void {
  if (isMac) {
    const hostPath = ensureShellWrapper()
    const manifest = {
      name: HOST_NAME,
      description: 'Vicu Browser Link native messaging bridge',
      path: hostPath,
      type: 'stdio',
      allowed_origins: extensionId ? [`chrome-extension://${extensionId}/`] : [],
    }

    // Register for Chrome
    const chromeDir = getMacChromeHostDir()
    mkdirSync(chromeDir, { recursive: true })
    writeFileSync(getMacManifestPath(chromeDir), JSON.stringify(manifest, null, 2), 'utf-8')

    // Also register for Edge (same manifest format)
    const edgeDir = getMacEdgeHostDir()
    mkdirSync(edgeDir, { recursive: true })
    writeFileSync(getMacManifestPath(edgeDir), JSON.stringify(manifest, null, 2), 'utf-8')
    return
  }

  if (!isWindows) return
  const hostPath = ensureBatWrapper()
  const manifestPath = getChromeHostManifestPath()
  const manifest = {
    name: HOST_NAME,
    description: 'Vicu Browser Link native messaging bridge',
    path: hostPath,
    type: 'stdio',
    allowed_origins: extensionId ? [`chrome-extension://${extensionId}/`] : [],
  }
  const dir = dirname(manifestPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')

  try {
    execSync(`reg add "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}" /ve /d "${manifestPath}" /f`, { stdio: 'ignore' })
  } catch { /* ignore */ }
}

export function registerFirefoxHost(): void {
  if (isMac) {
    const hostPath = ensureShellWrapper()
    const manifest = {
      name: HOST_NAME,
      description: 'Vicu Browser Link native messaging bridge',
      path: hostPath,
      type: 'stdio',
      allowed_extensions: ['browser-link@vicu.app'],
    }

    const firefoxDir = getMacFirefoxHostDir()
    mkdirSync(firefoxDir, { recursive: true })
    writeFileSync(getMacManifestPath(firefoxDir), JSON.stringify(manifest, null, 2), 'utf-8')
    return
  }

  if (!isWindows) return
  const hostPath = ensureBatWrapper()
  const manifestPath = getFirefoxHostManifestPath()
  const manifest = {
    name: HOST_NAME,
    description: 'Vicu Browser Link native messaging bridge',
    path: hostPath,
    type: 'stdio',
    allowed_extensions: ['browser-link@vicu.app'],
  }
  const dir = dirname(manifestPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')

  try {
    execSync(`reg add "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}" /ve /d "${manifestPath}" /f`, { stdio: 'ignore' })
  } catch { /* ignore */ }
}

export function unregisterHosts(): void {
  if (isMac) {
    // Remove manifests from all browser directories
    try { unlinkSync(getMacManifestPath(getMacChromeHostDir())) } catch { /* ignore */ }
    try { unlinkSync(getMacManifestPath(getMacFirefoxHostDir())) } catch { /* ignore */ }
    try { unlinkSync(getMacManifestPath(getMacEdgeHostDir())) } catch { /* ignore */ }
    // Remove shell wrapper
    try { unlinkSync(join(app.getPath('userData'), 'vicu-bridge.sh')) } catch { /* ignore */ }
    return
  }

  if (!isWindows) return
  const chromePath = getChromeHostManifestPath()
  const firefoxPath = getFirefoxHostManifestPath()
  try { unlinkSync(chromePath) } catch { /* ignore */ }
  try { unlinkSync(firefoxPath) } catch { /* ignore */ }
  try { execSync(`reg delete "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}" /f`, { stdio: 'ignore' }) } catch { /* ignore */ }
  try { execSync(`reg delete "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}" /f`, { stdio: 'ignore' }) } catch { /* ignore */ }
}

export function isRegistered(): { chrome: boolean; firefox: boolean } {
  if (isMac) {
    return {
      chrome: existsSync(getMacManifestPath(getMacChromeHostDir())),
      firefox: existsSync(getMacManifestPath(getMacFirefoxHostDir())),
    }
  }

  if (!isWindows) return { chrome: false, firefox: false }
  return {
    chrome: existsSync(getChromeHostManifestPath()),
    firefox: existsSync(getFirefoxHostManifestPath()),
  }
}

export function registerHosts(opts: RegistrationOptions): void {
  if (opts.chromeExtensionId) registerChromeHost(opts.chromeExtensionId)
  registerFirefoxHost()
}
