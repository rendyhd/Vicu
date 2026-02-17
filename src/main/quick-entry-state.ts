import type { BrowserWindow } from 'electron'

// Shared mutable state — set by index.ts, read by ipc-handlers.ts
// This avoids a circular dependency between the two modules.

type WindowGetter = () => BrowserWindow | null
export type HotkeyRegistrationResult = { entry: boolean; viewer: boolean }

type VoidFn = () => void
type HeightFn = (h: number) => void
type ApplySettingsFn = () => HotkeyRegistrationResult

let _getMainWindow: WindowGetter = () => null
let _getQuickEntryWindow: WindowGetter = () => null
let _getQuickViewWindow: WindowGetter = () => null
let _hideQuickEntry: VoidFn = () => {}
let _hideQuickView: VoidFn = () => {}
let _setViewerHeight: HeightFn = () => {}
let _applyQuickEntrySettings: ApplySettingsFn = () => ({ entry: false, viewer: false })

export function registerQuickEntryState(fns: {
  getMainWindow: WindowGetter
  getQuickEntryWindow: WindowGetter
  getQuickViewWindow: WindowGetter
  hideQuickEntry: VoidFn
  hideQuickView: VoidFn
  setViewerHeight: HeightFn
  applyQuickEntrySettings: ApplySettingsFn
}): void {
  _getMainWindow = fns.getMainWindow
  _getQuickEntryWindow = fns.getQuickEntryWindow
  _getQuickViewWindow = fns.getQuickViewWindow
  _hideQuickEntry = fns.hideQuickEntry
  _hideQuickView = fns.hideQuickView
  _setViewerHeight = fns.setViewerHeight
  _applyQuickEntrySettings = fns.applyQuickEntrySettings
}

export function getMainWindow(): BrowserWindow | null { return _getMainWindow() }
export function getQuickEntryWindow(): BrowserWindow | null { return _getQuickEntryWindow() }
export function getQuickViewWindow(): BrowserWindow | null { return _getQuickViewWindow() }
export function hideQuickEntry(): void { _hideQuickEntry() }
export function hideQuickView(): void { _hideQuickView() }
export function setViewerHeight(h: number): void { _setViewerHeight(h) }
export function applyQuickEntrySettings(): HotkeyRegistrationResult { return _applyQuickEntrySettings() }
