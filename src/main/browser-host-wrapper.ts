/**
 * Pure helpers for the browser native-messaging host: the wrapper script a browser launches, and
 * the arguments for the Windows registry tool. Kept free of Electron and the file system so they
 * can be tested.
 *
 * The host is the bundled vicu-bridge.js. It used to run with whatever `node` was on PATH, so
 * Browser Link silently did nothing without Node.js installed (D-BRW-1). The wrapper now runs the
 * script with the app's own binary and ELECTRON_RUN_AS_NODE=1, which is Node inside Electron.
 */

export interface HostRuntime {
  /** The binary that runs the bridge: the app executable (or the AppImage file on Linux). */
  execPath: string
  /** The bridge script (vicu-bridge.js). */
  bridgePath: string
}

export interface HostExecutableEnv {
  platform: NodeJS.Platform
  execPath: string
  /** process.env.APPIMAGE: set when the app runs from an AppImage. */
  appImage?: string
}

/**
 * Inside an AppImage `process.execPath` points into a temporary mount that is gone once the app
 * exits (and differs per launch). The AppImage file itself is the stable thing to run.
 */
export function resolveHostExecutable(env: HostExecutableEnv): string {
  if (env.platform === 'linux' && env.appImage) return env.appImage
  return env.execPath
}

function assertSafePath(label: string, value: string, windows: boolean): void {
  if (!value) throw new Error(`Browser host ${label} is empty`)
  // Control characters end a line; a double quote cannot appear in a Windows path and would break
  // out of the quoting in the .bat. In a POSIX single-quoted string a double quote is fine.
  // eslint-disable-next-line no-control-regex
  const bad = windows ? /[\u0000-\u001f"]/ : /[\u0000-\u001f]/
  if (bad.test(value)) throw new Error(`Browser host ${label} contains a character that cannot be quoted`)
}

/**
 * The .bat a Chromium or Firefox browser starts on Windows. Both paths are quoted; percent signs
 * are doubled because cmd expands them even inside quotes. A batch file is read in the OEM code
 * page, so a path with non-ASCII characters (an accented user name) needs UTF-8 switched on first.
 */
export function buildWindowsWrapper(runtime: HostRuntime): string {
  assertSafePath('executable path', runtime.execPath, true)
  assertSafePath('script path', runtime.bridgePath, true)
  const quote = (value: string): string => `"${value.replace(/%/g, '%%')}"`
  // eslint-disable-next-line no-control-regex
  const nonAscii = /[^\u0000-\u007f]/.test(runtime.execPath + runtime.bridgePath)
  const lines = [
    '@echo off',
    ...(nonAscii ? ['chcp 65001 >nul'] : []),
    'set ELECTRON_RUN_AS_NODE=1',
    `${quote(runtime.execPath)} ${quote(runtime.bridgePath)}`,
  ]
  return lines.join('\r\n') + '\r\n'
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** The shell wrapper a browser starts on macOS and Linux. */
export function buildPosixWrapper(runtime: HostRuntime): string {
  assertSafePath('executable path', runtime.execPath, false)
  assertSafePath('script path', runtime.bridgePath, false)
  return [
    '#!/bin/sh',
    'export ELECTRON_RUN_AS_NODE=1',
    `exec ${shellQuote(runtime.execPath)} ${shellQuote(runtime.bridgePath)}`,
  ].join('\n') + '\n'
}

// --- Windows registry (reg.exe), always called with an argument array ---

export type NativeMessagingBrowser = 'chrome' | 'firefox'

const REGISTRY_ROOTS: Record<NativeMessagingBrowser, string> = {
  chrome: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
  firefox: 'HKCU\\Software\\Mozilla\\NativeMessagingHosts',
}

export function hostRegistryKey(browser: NativeMessagingBrowser, hostName: string): string {
  return `${REGISTRY_ROOTS[browser]}\\${hostName}`
}

/** `reg add <key> /ve /d <manifest> /f`: sets the key's default value to the manifest path. */
export function registryAddArgs(key: string, manifestPath: string): string[] {
  return ['add', key, '/ve', '/d', manifestPath, '/f']
}

/** `reg delete <key> /f` */
export function registryDeleteArgs(key: string): string[] {
  return ['delete', key, '/f']
}
