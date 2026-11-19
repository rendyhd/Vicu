import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { WEB_CAPABILITIES, type CapabilityName } from '../../shared/capabilities'

// Every channel `window.api` can call is either answered by the web host or belongs to a feature
// the web version leaves out, which the renderer hides (src/shared/capabilities.ts). A channel that
// is neither would fail in the browser with nothing to say why, so it is refused here: handle it in
// src/web (or share its handler through src/main/handlers/portable.ts), or list it below with the
// capability that hides its callers.

const src = join(__dirname, '..', '..')

function files(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__') out.push(...files(full))
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

function channels(paths: string[], pattern: RegExp): Set<string> {
  const found = new Set<string>()
  for (const path of paths) for (const match of readFileSync(path, 'utf8').matchAll(pattern)) found.add(match[1])
  return found
}

const invoked = channels([join(src, 'shared', 'api-factory.ts')], /\binvoke\(\s*['"]([^'"]+)['"]/g)
const handledOnWeb = channels(
  [join(src, 'main', 'handlers', 'portable.ts'), join(src, 'main', 'collab-ipc.ts'), ...files(join(src, 'web'))],
  /\bhandle\(\s*['"]([^'"]+)['"]/g,
)

/** The channels the web version does not answer, by the capability whose absence hides their callers. */
const UNAVAILABLE: Array<{ capability: CapabilityName; matches: (channel: string) => boolean }> = [
  { capability: 'assistant', matches: (c) => c.startsWith('ai:') || c.startsWith('speech:') || c.startsWith('notes:') },
  { capability: 'voice', matches: (c) => c.startsWith('voice:') },
  { capability: 'offlineQueue', matches: (c) => c.startsWith('offline-queue:') },
  // Importing a calendar file into your own Events stays (src/web/files.ts).
  { capability: 'calendars', matches: (c) => c.startsWith('calendar:') && c !== 'calendar:import-file' },
  {
    capability: 'quickWindows',
    matches: (c) => c.startsWith('qe:') || c.startsWith('qv:') || ['apply-quick-entry-settings', 'get-global-shortcut-status', 'get-hotkey-launcher-command'].includes(c),
  },
  { capability: 'browserLink', matches: (c) => ['check-browser-host-registration', 'register-browser-hosts', 'open-browser-extension-folder'].includes(c) },
  { capability: 'obsidian', matches: (c) => c === 'test-obsidian-connection' },
  { capability: 'updates', matches: (c) => c.startsWith('update:') },
  {
    capability: 'windowControls',
    matches: (c) => c.startsWith('window-') || c === 'get-launch-on-startup-support',
  },
  // A completion sound of your own is a file on a computer.
  { capability: 'openFiles', matches: (c) => c === 'sound:pick' || c === 'sound:reset' },
  { capability: 'badge', matches: (c) => c === 'open-badge-notification-settings' },
  { capability: 'secretStorage', matches: (c) => c === 'get-secret-storage-status' },
]

describe('the channels of window.api in the web version', () => {
  it('finds the channels at all', () => {
    expect(invoked.size).toBeGreaterThan(150)
    expect(handledOnWeb.size).toBeGreaterThan(80)
  })

  it('answers every channel, or leaves it out with the feature it belongs to', () => {
    const unexplained = [...invoked]
      .filter((channel) => !handledOnWeb.has(channel))
      .filter((channel) => !UNAVAILABLE.some((group) => group.matches(channel)))
      .sort()
    expect(unexplained).toEqual([])
  })

  it('leaves a channel out only for a feature the web version does not have', () => {
    for (const group of UNAVAILABLE) expect(WEB_CAPABILITIES[group.capability], group.capability).toBe(false)
  })

  it('does not answer a channel of a feature it leaves out', () => {
    const answeredAnyway = [...handledOnWeb].filter((channel) => UNAVAILABLE.some((group) => group.matches(channel))).sort()
    expect(answeredAnyway).toEqual([])
  })

  it('registers no channel the page cannot call', () => {
    expect([...handledOnWeb].filter((channel) => !invoked.has(channel)).sort()).toEqual([])
  })
})
