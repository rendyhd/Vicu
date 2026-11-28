// `@host/env`, the web side: what the code needs to know about where it runs, read from the browser.

const platformName: string =
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
  ?? navigator.platform
  ?? ''

export const isMac = /mac/i.test(platformName)
export const isWindows = /win/i.test(platformName)
export const isLinux = !isMac && !isWindows

/** The operating system in the form `window.api.platform` uses (shortcut labels, platform styling). */
export const osPlatform: 'darwin' | 'win32' | 'linux' = isMac ? 'darwin' : isWindows ? 'win32' : 'linux'
