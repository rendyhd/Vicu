/**
 * The shape of the app's persisted configuration, shared by the main process (which owns and
 * normalizes it, src/main/config.ts) and the renderer (which reads it over IPC and sends patches).
 * One definition: the two sides used to keep hand-written copies that drifted apart (D-CFG-3).
 *
 * This file has no imports, so every tsconfig can include it.
 */

// --- Custom lists ----------------------------------------------------------------------------

/** The sort keys a custom list may use, in the order the editor offers them (same as Android). */
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
  custom_lists?: CustomList[]
  /** Owned by the custom list service in the main process; the renderer never writes it. */
  custom_lists_sync?: {
    device_id: string
    document: CustomListSyncDocumentV1
    dirty: boolean
    carrier_task_id?: number
    last_synced_at?: string
  }
  // Quick Entry / Quick View
  quick_entry_enabled?: boolean
  quick_view_enabled?: boolean
  quick_entry_hotkey?: string
  quick_view_hotkey?: string
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

/** Today lists open routines only while routines are on and the Today section is not turned off. */
export function showRoutinesInToday(
  config: Pick<AppConfig, 'routines_enabled' | 'routines_in_today'> | null | undefined,
): boolean {
  return isRoutinesEnabled(config) && config?.routines_in_today !== false
}
