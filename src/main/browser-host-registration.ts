import { app } from 'electron'
import { execSync } from 'child_process'
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

const HOST_NAME = 'com.vicu.browser'

export interface RegistrationOptions {
  chromeExtensionId: string
  firefoxExtensionId?: string
}

export function getBridgePath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'native-messaging-host', 'vicu-bridge.js')
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

export function registerChromeHost(extensionId: string): void {
  if (process.platform !== 'win32') return
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
  if (process.platform !== 'win32') return
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
  if (process.platform !== 'win32') return
  const chromePath = getChromeHostManifestPath()
  const firefoxPath = getFirefoxHostManifestPath()
  try { unlinkSync(chromePath) } catch { /* ignore */ }
  try { unlinkSync(firefoxPath) } catch { /* ignore */ }
  try { execSync(`reg delete "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}" /f`, { stdio: 'ignore' }) } catch { /* ignore */ }
  try { execSync(`reg delete "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}" /f`, { stdio: 'ignore' }) } catch { /* ignore */ }
}

export function isRegistered(): { chrome: boolean; firefox: boolean } {
  if (process.platform !== 'win32') return { chrome: false, firefox: false }
  return {
    chrome: existsSync(getChromeHostManifestPath()),
    firefox: existsSync(getFirefoxHostManifestPath()),
  }
}

export function registerHosts(opts: RegistrationOptions): void {
  if (opts.chromeExtensionId) registerChromeHost(opts.chromeExtensionId)
  registerFirefoxHost()
}
