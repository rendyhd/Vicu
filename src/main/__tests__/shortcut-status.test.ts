import { describe, it, expect } from 'vitest'
import { buildShortcutStatus } from '../shortcut-status'

describe('buildShortcutStatus', () => {
  it('does not flag waylandLimited when all enabled shortcuts register', () => {
    expect(
      buildShortcutStatus({
        entryEnabled: true,
        viewerEnabled: true,
        entryRegistered: true,
        viewerRegistered: true,
        isWaylandSession: true,
      })
    ).toEqual({ entry: true, viewer: true, waylandLimited: false })
  })

  it('flags waylandLimited when an enabled shortcut fails on Wayland', () => {
    expect(
      buildShortcutStatus({
        entryEnabled: true,
        viewerEnabled: true,
        entryRegistered: false,
        viewerRegistered: true,
        isWaylandSession: true,
      })
    ).toEqual({ entry: false, viewer: true, waylandLimited: true })
  })

  it('does not flag waylandLimited for failed registration outside Wayland', () => {
    expect(
      buildShortcutStatus({
        entryEnabled: true,
        viewerEnabled: false,
        entryRegistered: false,
        viewerRegistered: false,
        isWaylandSession: false,
      })
    ).toEqual({ entry: false, viewer: false, waylandLimited: false })
  })

  it('treats disabled shortcuts as not registered and not failures', () => {
    expect(
      buildShortcutStatus({
        entryEnabled: false,
        viewerEnabled: false,
        entryRegistered: false,
        viewerRegistered: false,
        isWaylandSession: true,
      })
    ).toEqual({ entry: false, viewer: false, waylandLimited: false })
  })

  it('flags waylandLimited for partial viewer failure only', () => {
    expect(
      buildShortcutStatus({
        entryEnabled: false,
        viewerEnabled: true,
        entryRegistered: false,
        viewerRegistered: false,
        isWaylandSession: true,
      })
    ).toEqual({ entry: false, viewer: false, waylandLimited: true })
  })
})
