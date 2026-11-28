import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The web version has no assistant, voice input, offline queue, connected calendars, Quick Entry,
// update check, window controls and so on (src/shared/capabilities.ts). A feature the host lacks
// shows no button, setting or shortcut and none of its background code calls window.api for it:
// nothing is shown disabled. This scan finds a file that reaches for one of those parts of
// `window.api` (directly or through lib/api.ts) without asking the host first.

const RENDERER = resolve(__dirname, '../..')

/** The namespaces of `window.api` only some hosts have. `calendar.importFile` stays on the web. */
const NAMESPACE_USES = [
  /\bapi\.(ai|speech|voice|offlineQueue)\b/,
  /\bapi\.calendar\.(?!importFile\b)\w+/,
]

/** Methods of `window.api` (or lib/api.ts) only some hosts have. */
const GATED_METHODS = [
  'checkForUpdate',
  'getUpdateStatus',
  'dismissUpdate',
  'onUpdateAvailable',
  'setTaskBadge',
  'openBadgeNotificationSettings',
  'windowMinimize',
  'windowMaximize',
  'windowClose',
  'windowIsMaximized',
  'checkBrowserHostRegistration',
  'registerBrowserHosts',
  'openBrowserExtensionFolder',
  'testObsidianConnection',
  'applyQuickEntrySettings',
  'getGlobalShortcutStatus',
  'getSecretStorageStatus',
  'getLaunchOnStartupSupport',
  'getHotkeyLauncherCommand',
  'getStandaloneTaskCount',
  'uploadStandaloneTasks',
  'pickCompletionSound',
  'resetCompletionSound',
]
const METHOD_USE = new RegExp(`\\bapi\\.(${GATED_METHODS.join('|')})\\b`)

/**
 * Files that use a gated part of `window.api` without importing the capabilities helper, and why
 * that is fine. Keep each reason to one line; prefer asking the host in the file itself.
 */
const ALLOWLIST: Record<string, string> = {
  'lib/api.ts': 'the typed wrappers themselves; every caller is checked here, and queueOptions asks the host',
  'components/ai/AiHost.tsx': 'only rendered by AppShell behind can(assistant)',
  'components/ai/DictationHost.tsx': 'only rendered by AppShell behind can(assistant)',
  'components/ai/NotesImportDialog.tsx': 'only rendered by AppShell behind can(assistant)',
  'components/settings/AssistantSettings.tsx': 'the Assistant tab, which settingsGroups leaves out without can(assistant)',
  'components/settings/VoiceSettings.tsx': 'only rendered by SettingsView behind can(voice)',
  'components/settings/BrowserSettings.tsx': 'only rendered by SettingsView behind can(browserLink)',
  'components/settings/ObsidianSettings.tsx': 'only rendered by SettingsView behind can(obsidian)',
  'components/settings/QuickEntrySettings.tsx': 'the Quick Entry / View tab, which settingsGroups leaves out without can(quickWindows)',
  'components/layout/WindowControls.tsx': 'only rendered by AppShell behind can(windowControls)',
  'components/UpdateBanner.tsx': 'only rendered by AppShell behind can(updates)',
  'components/planner/AddCalendarDialog.tsx': 'only rendered by CalendarFeeds behind can(calendars)',
  'components/planner/LocalCalendarForms.tsx': 'only rendered by AddCalendarDialog, which needs can(calendars)',
  'components/planner/MacCalendarsForm.tsx': 'only rendered by AddCalendarDialog, which needs can(calendars)',
  'components/planner/OAuthAccountForm.tsx': 'only rendered by AddCalendarDialog, which needs can(calendars)',
  'components/pro/ImportDialog.tsx': 'the assistant path is behind useProAssistantOn, which needs can(assistant)',
  'components/pro/PromiseDrafts.tsx': 'only rendered by MeetingView behind useProAssistantOn, which needs can(assistant)',
  'components/task-list/AttachmentPickerPopover.tsx': 'its queue buttons are on uploads that wait in the queue, and there are none without it',
  'stores/ask-store.ts': 'only driven by AskHost, AskPane and the palette, which need can(assistant)',
  'stores/dictation-store.ts': 'only driven by DictationHost and entries that need can(assistant)',
  'stores/notes-store.ts': 'only driven by NotesHost, which needs can(assistant)',
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'quick-entry' || name === 'quick-view' || name === 'node_modules') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sourceFiles(path, out)
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(path)
  }
  return out
}

/** The same source without comments, so a sentence about `window.api.ai` is not a use. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

const asksTheHost = (text: string): boolean =>
  [...text.matchAll(/from\s+['"]([^'"]*\/capabilities)['"]/g)].some((match) => !match[1].includes('shared/'))

describe('features a host lacks', () => {
  const offenders: string[] = []
  const stale: string[] = []
  for (const file of sourceFiles(RENDERER)) {
    const path = relative(RENDERER, file).replace(/\\/g, '/')
    const text = code(readFileSync(file, 'utf8'))
    const uses = NAMESPACE_USES.some((pattern) => pattern.test(text)) || METHOD_USE.test(text)
    if (!uses) {
      if (path in ALLOWLIST) stale.push(path)
      continue
    }
    if (asksTheHost(text) || path in ALLOWLIST) continue
    offenders.push(path)
  }

  it('asks the host before reaching for a gated part of window.api', () => {
    expect(
      offenders,
      'These files use a part of window.api that only some hosts have (assistant, voice, offline queue, calendars, '
      + 'updates, window controls, badge, quick windows, Obsidian, browser link, standalone, files). Import can() from '
      + "'@/lib/capabilities' and render or run the feature only when the host has it, or, if every caller is already "
      + 'gated, add the file to ALLOWLIST with a one-line reason.',
    ).toEqual([])
  })

  it('keeps the allowlist to files that still need it', () => {
    expect(stale, 'These files no longer use a gated part of window.api: remove them from ALLOWLIST.').toEqual([])
  })
})
