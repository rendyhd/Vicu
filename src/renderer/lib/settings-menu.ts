/**
 * The Settings menu: its tabs in two groups, and where it is drawn. A wide content region shows it
 * as a column beside the settings; a narrow one hands it the app sidebar's place (with Back to app),
 * so the settings keep their width. Pure, so the rules are tested without a window.
 */

export type SettingsTab = 'general' | 'projects' | 'integrations' | 'notifications' | 'assistant' | 'pro' | 'shortcuts'

export interface SettingsTabInfo {
  key: SettingsTab
  label: string
}

export interface SettingsGroup {
  label: string
  tabs: SettingsTabInfo[]
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: 'Account and app', // i18n-ignore: the key of GROUP_LABELS in SettingsMenu
    tabs: [
      { key: 'general', label: 'General' }, // i18n-ignore: shown through SETTINGS_TAB_LABELS in SettingsMenu
      { key: 'projects', label: 'Projects' }, // i18n-ignore: shown through SETTINGS_TAB_LABELS in SettingsMenu
      { key: 'notifications', label: 'Notifications' }, // i18n-ignore: shown through SETTINGS_TAB_LABELS in SettingsMenu
    ],
  },
  {
    label: 'Features', // i18n-ignore: the key of GROUP_LABELS in SettingsMenu
    tabs: [
      { key: 'integrations', label: 'Quick Entry / View' }, // i18n-ignore: shown through SETTINGS_TAB_LABELS in SettingsMenu
      { key: 'assistant', label: 'Assistant' }, // i18n-ignore: shown through SETTINGS_TAB_LABELS in SettingsMenu
      { key: 'pro', label: 'Pro' }, // i18n-ignore: shown through SETTINGS_TAB_LABELS in SettingsMenu
      { key: 'shortcuts', label: 'Keyboard Shortcuts' }, // i18n-ignore: shown through SETTINGS_TAB_LABELS in SettingsMenu
    ],
  },
]

/** What the host leaves out of the menu: the tabs of features it lacks (src/shared/capabilities.ts). */
export interface SettingsHost {
  assistant: boolean
  quickWindows: boolean
}

/**
 * The tabs this host offers: every tab on the desktop; the web version has no Assistant and no
 * Quick Entry / View. A group left empty is dropped.
 */
export function settingsGroups(host: SettingsHost): SettingsGroup[] {
  const offered = (tab: SettingsTab): boolean => {
    if (tab === 'assistant') return host.assistant
    if (tab === 'integrations') return host.quickWindows
    return true
  }
  return SETTINGS_GROUPS
    .map((group) => ({ ...group, tabs: group.tabs.filter((tab) => offered(tab.key)) }))
    .filter((group) => group.tabs.length > 0)
}

export function settingsTabLabel(tab: SettingsTab): string {
  for (const group of SETTINGS_GROUPS) {
    const found = group.tabs.find((t) => t.key === tab)
    if (found) return found.label
  }
  return 'Settings' // i18n-ignore: English fallback of the lookup above
}

/** Width of the menu column beside the settings. */
export const SETTINGS_MENU_WIDTH = 208
/** The least width the settings themselves need next to the column. */
export const SETTINGS_CONTENT_MIN = 560

/**
 * Whether the menu takes the app sidebar's place: the content region (right of the app sidebar and
 * left of a side pane) has no room for the column and the settings. The region keeps its width when
 * the menu moves, so the answer does not flip back and forth. 0 means not measured yet.
 */
export function settingsMenuInSidebar(contentWidth: number): boolean {
  return contentWidth > 0 && contentWidth < SETTINGS_MENU_WIDTH + SETTINGS_CONTENT_MIN
}

/** How far below the top of the scroll area a section heading may be and still count as the one being read. */
export const SECTION_READ_OFFSET = 96

/**
 * The section being read: the last heading at or above the reading line (`tops` are the headings'
 * distances from the top of the scroll area). Scrolled to the end, it is the last section, which may
 * be too short to reach the line. -1 when there are no sections.
 */
export function currentSectionIndex(tops: number[], atEnd: boolean): number {
  if (tops.length === 0) return -1
  if (atEnd) return tops.length - 1
  let current = 0
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= SECTION_READ_OFFSET) current = i
  }
  return current
}
