import { ELECTRON_CAPABILITIES, type CapabilityName, type HostCapabilities } from '../../shared/capabilities'

export type { CapabilityName, HostCapabilities }

/**
 * What the host this window runs in can do (src/shared/capabilities.ts). The desktop app can do
 * everything; the web version leaves features out, and what it lacks is hidden, never shown
 * disabled. Fixed for the life of the window, so it can be read anywhere, in or outside React.
 *
 * A window without the object (a test that sets up `window.api` by hand) is the desktop app.
 */
export function capabilities(): HostCapabilities {
  const fromHost = typeof window !== 'undefined' ? (window as { api?: { capabilities?: HostCapabilities } }).api?.capabilities : undefined
  return fromHost ?? ELECTRON_CAPABILITIES
}

/** Whether the host has a feature. */
export function can(name: CapabilityName): boolean {
  return capabilities()[name]
}

/** True in the web version (a browser tab), false in the desktop app. */
export function isWebHost(): boolean {
  return capabilities().host === 'web'
}
