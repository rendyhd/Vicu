// `@host/env`, the Electron side: what the code needs to know about where it runs. The web build
// swaps this module for src/web/host/env.ts.
export { isMac, isWindows, isLinux } from '../platform'
/** The operating system, in Node's spelling. */
export const osPlatform: string = process.platform
