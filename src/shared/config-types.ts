/**
 * The shape of the app's persisted configuration, shared by the main process (which owns and
 * normalizes it, src/main/config.ts) and the renderer (which reads it over IPC and sends patches).
 * One definition: the two sides used to keep hand-written copies that drifted apart (D-CFG-3).
 *
 * This file has no imports, so every tsconfig can include it.
 */

// --- Custom lists ----------------------------------------------------------------------------

/** The sort keys a custom list may use, in the order the editor offers them (same as Android). */
import type { SyncedPrefsDocument } from './synced-prefs'
import type { TodayRoutinesLimit } from './today-routines'

export const CUSTOM_LIST_SORT_FIELDS = [
  'due_date',
  'created',
  'updated',
  'priority',
  'title',
  'done_at',
  'position',
] as const
export type CustomListSortField = (typeof CUSTOM_LIST_SORT_FIELDS)[number]

export interface CustomListRevision {
  wall_time_ms: number
  counter: number
  device_id: string
}

/**
 * The filter of a synced list. Fields this version does not know (added by a newer app) are kept
 * as they are (cross-app semantics v1, section 3), hence the index signature.
 */
export interface CustomListWireFilter {
  project_ids: number[]
  project_filter_mode: 'include' | 'exclude'
  add_to_project_id: number
  sort_by: string
  order_by: string
  due_date_filter: string
  priority_filter: number[]
  label_ids: number[]
  include_done: boolean
  include_today_all_projects: boolean
  /** Whether date windows also include overdue tasks. Absent means true. */
  include_overdue?: boolean
  /** 'me', 'others' or 'nobody' (section 3.3 of the contract); another string is kept and is no condition. */
  assigned?: string
  /** 'unread' or 'any'; another string is kept and is no condition. */
  comments?: string
  /** Only tasks of shared projects. Written only when true. */
  shared_only?: boolean
  /** Only tasks changed on the last N local days, today included. Written only when a whole number of 1 or more. */
  changed_within_days?: number
  [unknownField: string]: unknown
}

export interface CustomListWire {
  id: string
  name: string
  icon: string
  filter: CustomListWireFilter
  [unknownField: string]: unknown
}

export interface CustomListSyncRecord {
  value: CustomListWire | null
  revision: CustomListRevision
}

export interface CustomListSyncDocumentV1 {
  version: 1
  lists: Record<string, CustomListSyncRecord>
  order: { ids: string[]; revision: CustomListRevision }
}

/**
 * The conditions of a list as the app keeps them in its config and shows them in the renderer.
 * `sort_by` and `due_date_filter` are strings: a list synced from a newer app may use a value this
 * version does not know, and it must survive the round trip (see CUSTOM_LIST_SORT_FIELDS for the
 * ones the editor offers).
 */
export interface CustomListFilter {
  project_ids: number[]
  project_filter_mode?: 'include' | 'exclude'
  /** 0 resolves to the configured Inbox. */
  add_to_project_id?: number
  sort_by: string
  order_by: string
  due_date_filter: string
  priority_filter?: number[]
  label_ids?: number[]
  include_done?: boolean
  include_today_all_projects?: boolean
  /** Whether the today / this week / this month windows also include overdue tasks. Absent means true. */
  include_overdue?: boolean
  /** 'me', 'others' or 'nobody' (section 3.3 of the contract); another string is kept and is no condition. */
  assigned?: string
  /** 'unread' or 'any'; another string is kept and is no condition. */
  comments?: string
  /** Only tasks of shared projects. Written only when true. */
  shared_only?: boolean
  /** Only tasks changed on the last N local days, today included. Written only when a whole number of 1 or more. */
  changed_within_days?: number
  [unknownField: string]: unknown
}

export interface CustomList {
  id: string
  name: string
  icon?: string
  filter: CustomListFilter
  [unknownField: string]: unknown
}

export type CustomListSyncStatus =
  | { state: 'idle'; last_synced_at?: string }
  | { state: 'syncing' }
  | { state: 'pending'; message?: string }
  | { state: 'offline'; message: string }
  | { state: 'error'; message: string }
  | { state: 'update_required'; message: string }
  | { state: 'local_only' }

/**
 * The synced documents (custom lists, synced settings) whose local copy holds changes the server
 * has not got: each one's sync status, or null when it has none. Not part of the offline queue.
 */
export interface UnsyncedDocuments {
  customLists: CustomListSyncStatus | null
  preferences: CustomListSyncStatus | null
}

// --- Quick View, review, connection ----------------------------------------------------------

export interface ViewerFilter {
  project_ids: number[]
  sort_by: string
  order_by: string
  due_date_filter: string
  include_today_all_projects?: boolean
  custom_list_id?: string
  view_type?: 'today' | 'upcoming' | 'anytime'
  // The conditions of a custom list. The Quick View settings never write these; they are filled
  // in memory when the viewer points at a custom list (see src/main/quick-entry/viewer-filter.ts).
  project_filter_mode?: 'include' | 'exclude'
  include_done?: boolean
  include_overdue?: boolean
  priority_filter?: number[]
  label_ids?: number[]
  assigned?: string
  comments?: string
  shared_only?: boolean
  changed_within_days?: number
}

export interface SecondaryProject {
  id: number
  title: string
}

export interface ReviewConfig {
  enabled: boolean
  default_cadence_days: number
  exclude_inbox: boolean
}

export type AuthMethod = 'api_token' | 'oidc' | 'password'

/**
 * What a setup, login or disconnect flow may change. Everything else in the config (preferences,
 * hotkeys, window state...) is kept by the main process.
 */
export interface ConnectionFields {
  vikunja_url: string
  api_token: string
  auth_method: AuthMethod
  /** Omit to keep the current inbox on the same server (0 on a different one). */
  inbox_project_id?: number
}

// --- The configuration -----------------------------------------------------------------------

export interface AppConfig {
  vikunja_url: string
  api_token: string
  inbox_project_id: number
  auth_method?: AuthMethod
  theme: 'light' | 'dark' | 'system'
  /**
   * The clock in dates and times: follow the system locale's hour cycle (the default), or force
   * the 12-hour or 24-hour clock for an OS custom format the web engine cannot see. Missing
   * means 'system'.
   */
  clock_format?: 'system' | '12h' | '24h'
  window_bounds?: { x: number; y: number; width: number; height: number }
  sidebar_width?: number
  /**
   * Ids of the sidebar projects (areas) the person collapsed. Everything else shows its child
   * projects. Ids belong to one server, so this is dropped with the rest of the account's data.
   */
  sidebar_collapsed_projects?: number[]
  /**
   * Ids of the sidebar's project categories the person collapsed (cross-app semantics 13.3: per
   * device, never synced). They belong to one account, so this is dropped with its data.
   */
  sidebar_collapsed_categories?: string[]
  /**
   * The smart lists the person took out of the sidebar (`SIDEBAR_HIDEABLE_LISTS`). Per device and
   * kept through sign-out, like Android's drawer setting; never synced. A hidden list keeps working
   * and stays in the command palette. A name this version does not know (a newer one wrote it) is kept.
   */
  sidebar_hidden_lists?: string[]
  custom_lists?: CustomList[]
  /** Owned by the custom list service in the main process; the renderer never writes it. */
  custom_lists_sync?: {
    device_id: string
    document: CustomListSyncDocumentV1
    dirty: boolean
    carrier_task_id?: number
    last_synced_at?: string
  }
  /**
   * The synced preferences (cross-app semantics section 11): the local copy of the `vicu-prefs:v1`
   * carrier, owned by `src/main/synced-preferences.ts`; the renderer never writes it. `moved` is set
   * once the settings this device kept before they synced were moved into it (section 11.5).
   */
  synced_prefs_sync?: {
    device_id: string
    document: SyncedPrefsDocument
    dirty: boolean
    carrier_task_id?: number
    last_synced_at?: string
    moved?: boolean
  }
  /**
   * The signed-in Vikunja user, as `GET user` answered it (owned by main, `src/main/known-user.ts`).
   * Hidden tasks are read and written only when they belong to this user (cross-app semantics 10.3).
   */
  known_user?: { server: string; id: number }
  /**
   * The user the account data in this config belongs to (custom lists, synced settings, the Inbox).
   * Unlike `known_user` it outlives signing out, so a different user of the same server signing in
   * afterwards is noticed and does not inherit it (`claimAccountData` in `src/main/known-user.ts`).
   */
  account_owner?: { server: string; id: number }
  // Quick Entry / Quick View
  quick_entry_enabled?: boolean
  quick_view_enabled?: boolean
  quick_entry_hotkey?: string
  quick_view_hotkey?: string
  /**
   * The in-app voice shortcut (an Electron accelerator such as `Command+Shift+D`; '' or missing is
   * off, the default): hold it in the main window to say a task, or tap it to start and stop
   * (docs/voice-input.md).
   */
  voice_hotkey?: string
  quick_entry_default_project_id?: number
  exclamation_today?: boolean
  project_cycle_modifier?: 'ctrl' | 'alt' | 'ctrl+alt'
  secondary_projects?: SecondaryProject[]
  quick_entry_position?: { x: number; y: number }
  quick_view_position?: { x: number; y: number }
  viewer_filter?: ViewerFilter
  launch_on_startup?: boolean
  /** Start in the tray, without showing the main window, when launched at login. */
  start_hidden?: boolean
  standalone_mode?: boolean
  show_today_overdue_badge?: boolean
  /** Progress rings next to the projects in the sidebar. Missing means on. */
  show_project_progress?: boolean
  /** Each project's number of open tasks in the sidebar, beside the ring when both are on. Missing means off. */
  show_project_task_count?: boolean
  // Obsidian
  obsidian_mode?: 'off' | 'ask' | 'always'
  obsidian_api_key?: string
  obsidian_port?: number
  obsidian_vault_name?: string
  // Browser
  browser_link_mode?: 'off' | 'ask' | 'always'
  browser_extension_id?: string
  // Notifications
  notifications_enabled?: boolean
  notifications_persistent?: boolean
  notifications_daily_reminder_enabled?: boolean
  notifications_daily_reminder_time?: string
  notifications_secondary_reminder_enabled?: boolean
  notifications_secondary_reminder_time?: string
  notifications_overdue_enabled?: boolean
  notifications_due_today_enabled?: boolean
  notifications_upcoming_enabled?: boolean
  notifications_sound?: boolean
  // Task reminder settings
  notifications_task_reminder_sound?: boolean
  notifications_task_reminder_persistent?: boolean
  /** Seconds; 0 = disabled. */
  notifications_default_reminder_offset?: number
  notifications_default_reminder_relative_to?: 'due_date' | 'start_date' | 'end_date'
  // Update checker
  update_check_dismissed_version?: string
  // Migration flags
  hotkeys_migrated_macos?: boolean
  // NLP task parser
  nlp_enabled?: boolean
  nlp_syntax_mode?: 'todoist' | 'vikunja'
  // Delete confirmation
  confirm_before_delete?: boolean
  // Subtask presentation in task lists
  subtask_display?: 'inside_task' | 'expandable'
  // Task completion sound
  task_completion_sound_enabled?: boolean
  task_completion_sound_path?: string | null
  // Last directory used by file open dialogs (attachments, sound picker)
  last_file_dialog_directory?: string | null
  /** The username of the last password login; shown on the sign-in screen. */
  last_username?: string
  // Task context menu
  urgency_mode?: 'today' | 'important'
  last_used_project_id?: number
  last_used_label_id?: number
  // Project review
  review?: ReviewConfig
  // Routines
  /** Routines feature (sidebar entry, Today section, reminders). Missing means on. */
  routines_enabled?: boolean
  /** Whether Today shows the routines still open today. Missing means on. */
  routines_in_today?: boolean
  /** How many due-now routines Today shows (cross-app semantics 6.10). Missing means 2. */
  routines_today_limit?: TodayRoutinesLimit
  /** Today's routine section is folded to its header (per device). */
  routines_today_folded?: boolean
}

// --- Defaults every reader shares -------------------------------------------------------------

/**
 * Quick Entry and Quick View are off until the user turns them on. `normalizeConfig` stores
 * `false` for a missing value, so every process that asks "is it on?" must read a missing value
 * the same way (it used to be "on" in the startup code and "off" everywhere else).
 */
export function isQuickEntryEnabled(config: Pick<AppConfig, 'quick_entry_enabled'> | null | undefined): boolean {
  return config?.quick_entry_enabled === true
}

export function isQuickViewEnabled(config: Pick<AppConfig, 'quick_view_enabled'> | null | undefined): boolean {
  return config?.quick_view_enabled === true
}

/** Routines are on unless the user turned them off (configs from before the setting have none). */
export function isRoutinesEnabled(config: Pick<AppConfig, 'routines_enabled'> | null | undefined): boolean {
  return config?.routines_enabled !== false
}

/** The smart lists Settings can take out of the sidebar, in the sidebar's order; the Inbox always stays. */
export const SIDEBAR_HIDEABLE_LISTS = ['today', 'routines', 'upcoming', 'anytime', 'review', 'logbook'] as const
export type SidebarHideableList = (typeof SIDEBAR_HIDEABLE_LISTS)[number]

/** Whether the person took `list` out of the sidebar (Settings → General → Sidebar). */
export function isHiddenFromSidebar(config: Pick<AppConfig, 'sidebar_hidden_lists'> | null | undefined, list: string): boolean {
  return config?.sidebar_hidden_lists?.includes(list) === true
}

/** The hidden lists with `list` taken out of the sidebar or put back; names this version does not know stay. */
export function withSidebarListHidden(
  config: Pick<AppConfig, 'sidebar_hidden_lists'> | null | undefined,
  list: SidebarHideableList,
  hidden: boolean,
): string[] {
  const rest = (config?.sidebar_hidden_lists ?? []).filter((id) => id !== list)
  return hidden ? [...rest, list] : rest
}

/** Today lists open routines only while routines are on and the Today section is not turned off. */
export function showRoutinesInToday(
  config: Pick<AppConfig, 'routines_enabled' | 'routines_in_today'> | null | undefined,
): boolean {
  return isRoutinesEnabled(config) && config?.routines_in_today !== false
}
