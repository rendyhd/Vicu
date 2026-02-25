import { app } from 'electron'
import { execSync } from 'child_process'
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { isMac, isWindows } from './platform'

const HOST_NAME = 'com.vicu.browser'
// The existing signed Firefox extension (on AMO) from vikunja-quick-entry
// connects to this host name. Register under both so users can use one
// Firefox extension with either app.
const VQE_HOST_NAME = 'com.vikunja_quick_entry.browser'

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

function getFirefoxHostManifestPath(hostName: string = HOST_NAME): string {
  return join(app.getPath('userData'), `${hostName}.firefox.json`)
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

function getMacManifestPath(browserDir: string, hostName: string = HOST_NAME): string {
  return join(browserDir, `${hostName}.json`)
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
    const firefoxDir = getMacFirefoxHostDir()
    mkdirSync(firefoxDir, { recursive: true })

    // Vicu's own future Firefox extension
    const vicuManifest = {
      name: HOST_NAME,
      description: 'Vicu Browser Link native messaging bridge',
      path: hostPath,
      type: 'stdio',
      allowed_extensions: ['browser-link@vicu.app'],
    }
    writeFileSync(getMacManifestPath(firefoxDir, HOST_NAME), JSON.stringify(vicuManifest, null, 2), 'utf-8')

    // vikunja-quick-entry's signed Firefox extension (already on AMO)
    const vqeManifest = {
      name: VQE_HOST_NAME,
      description: 'Vicu Browser Link native messaging bridge (vikunja-quick-entry compat)',
      path: hostPath,
      type: 'stdio',
      allowed_extensions: ['browser-link@vikunja-quick-entry.app'],
    }
    writeFileSync(getMacManifestPath(firefoxDir, VQE_HOST_NAME), JSON.stringify(vqeManifest, null, 2), 'utf-8')
    return
  }

  if (!isWindows) return
  const hostPath = ensureBatWrapper()

  // Vicu's own future Firefox extension
  const vicuManifestPath = getFirefoxHostManifestPath(HOST_NAME)
  const vicuManifest = {
    name: HOST_NAME,
    description: 'Vicu Browser Link native messaging bridge',
    path: hostPath,
    type: 'stdio',
    allowed_extensions: ['browser-link@vicu.app'],
  }
  const vicuDir = dirname(vicuManifestPath)
  if (!existsSync(vicuDir)) mkdirSync(vicuDir, { recursive: true })
  writeFileSync(vicuManifestPath, JSON.stringify(vicuManifest, null, 2), 'utf-8')
  try {
    execSync(`reg add "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}" /ve /d "${vicuManifestPath}" /f`, { stdio: 'ignore' })
  } catch { /* ignore */ }

  // vikunja-quick-entry's signed Firefox extension (already on AMO)
  const vqeManifestPath = getFirefoxHostManifestPath(VQE_HOST_NAME)
  const vqeManifest = {
    name: VQE_HOST_NAME,
    description: 'Vicu Browser Link native messaging bridge (vikunja-quick-entry compat)',
    path: hostPath,
    type: 'stdio',
    allowed_extensions: ['browser-link@vikunja-quick-entry.app'],
  }
  writeFileSync(vqeManifestPath, JSON.stringify(vqeManifest, null, 2), 'utf-8')
  try {
    execSync(`reg add "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${VQE_HOST_NAME}" /ve /d "${vqeManifestPath}" /f`, { stdio: 'ignore' })
  } catch { /* ignore */ }
}

export function unregisterHosts(): void {
  if (isMac) {
    // Remove manifests from all browser directories
    try { unlinkSync(getMacManifestPath(getMacChromeHostDir())) } catch { /* ignore */ }
    try { unlinkSync(getMacManifestPath(getMacEdgeHostDir())) } catch { /* ignore */ }
    // Firefox: remove both Vicu and VQE compat manifests
    try { unlinkSync(getMacManifestPath(getMacFirefoxHostDir(), HOST_NAME)) } catch { /* ignore */ }
    try { unlinkSync(getMacManifestPath(getMacFirefoxHostDir(), VQE_HOST_NAME)) } catch { /* ignore */ }
    // Remove shell wrapper
    try { unlinkSync(join(app.getPath('userData'), 'vicu-bridge.sh')) } catch { /* ignore */ }
    return
  }

  if (!isWindows) return
  const chromePath = getChromeHostManifestPath()
  try { unlinkSync(chromePath) } catch { /* ignore */ }
  // Firefox: remove both Vicu and VQE compat manifests + registry keys
  try { unlinkSync(getFirefoxHostManifestPath(HOST_NAME)) } catch { /* ignore */ }
  try { unlinkSync(getFirefoxHostManifestPath(VQE_HOST_NAME)) } catch { /* ignore */ }
  try { execSync(`reg delete "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}" /f`, { stdio: 'ignore' }) } catch { /* ignore */ }
  try { execSync(`reg delete "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}" /f`, { stdio: 'ignore' }) } catch { /* ignore */ }
  try { execSync(`reg delete "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${VQE_HOST_NAME}" /f`, { stdio: 'ignore' }) } catch { /* ignore */ }
}

export function isRegistered(): { chrome: boolean; firefox: boolean } {
  if (isMac) {
    const firefoxDir = getMacFirefoxHostDir()
    return {
      chrome: existsSync(getMacManifestPath(getMacChromeHostDir())),
      firefox: existsSync(getMacManifestPath(firefoxDir, HOST_NAME))
        && existsSync(getMacManifestPath(firefoxDir, VQE_HOST_NAME)),
    }
  }

  if (!isWindows) return { chrome: false, firefox: false }
  return {
    chrome: existsSync(getChromeHostManifestPath()),
    firefox: existsSync(getFirefoxHostManifestPath(HOST_NAME))
      && existsSync(getFirefoxHostManifestPath(VQE_HOST_NAME)),
  }
}

export function registerHosts(opts: RegistrationOptions): void {
  if (opts.chromeExtensionId) registerChromeHost(opts.chromeExtensionId)
  registerFirefoxHost()
}
