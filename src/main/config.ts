import { app } from 'electron'
import { join } from 'path'
import { isMac } from './platform'
import { readFileWithBackup, writeFileAtomic } from './atomic-file'
import type { CustomListSyncDocumentV1 } from './custom-list-protocol'

export interface ViewerFilter {
  project_ids: number[]
  sort_by: string
  order_by: string
  due_date_filter: string
  include_today_all_projects?: boolean
  custom_list_id?: string
  view_type?: 'today' | 'upcoming' | 'anytime'
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

export interface AppConfig {
  vikunja_url: string
  api_token: string
  inbox_project_id: number
  auth_method?: 'api_token' | 'oidc' | 'password'
  theme: 'light' | 'dark' | 'system'
  window_bounds?: { x: number; y: number; width: number; height: number }
  sidebar_width?: number
  custom_lists?: Array<{
    id: string
    name: string
    icon?: string
    filter: {
      project_ids: number[]
      project_filter_mode?: 'include' | 'exclude'
      add_to_project_id?: number
      sort_by: string
      order_by: string
      due_date_filter: string
      priority_filter?: number[]
      label_ids?: number[]
      include_done?: boolean
      include_today_all_projects?: boolean
    }
  }>
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
  notifications_default_reminder_offset?: number  // seconds, 0 = disabled
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
  // Cached username for re-login screen
  last_username?: string
  // Task context menu
  urgency_mode?: 'today' | 'important'
  last_used_project_id?: number
  last_used_label_id?: number
  // Project review
  review?: ReviewConfig
}

// Platform-aware hotkey defaults
export const DEFAULT_QUICK_ENTRY_HOTKEY = isMac ? 'Command+Shift+Space' : 'Alt+Shift+V'
export const DEFAULT_QUICK_VIEW_HOTKEY = isMac ? 'Command+Shift+B' : 'Alt+Shift+B'

const CONFIG_FILENAME = 'config.json'

const DEFAULT_CONFIG: AppConfig = {
  vikunja_url: '',
  api_token: '',
  inbox_project_id: 0,
  theme: 'system',
  subtask_display: 'inside_task',
  review: {
    enabled: true,
    default_cadence_days: 14,
    exclude_inbox: true,
  },
}

function getConfigPath(): string {
  return join(app.getPath('userData'), CONFIG_FILENAME)
}

// In-memory cache: the config file is only ever written through saveConfig,
// so disk reads after the first are redundant. Callers receive clones —
// mutating a returned config object must not leak into the cache.
let cachedConfig: AppConfig | null | undefined

export function loadConfig(): AppConfig | null {
  if (cachedConfig === undefined) {
    cachedConfig = readConfigFromDisk()
  }
  return cachedConfig ? structuredClone(cachedConfig) : null
}

function parseConfigFile(raw: string): AppConfig {
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('config.json does not contain an object')
  }
  return normalizeConfig(parsed as Record<string, unknown>)
}

function readConfigFromDisk(): AppConfig | null {
  // Falls back to config.json.bak (and logs it) when the file does not parse.
  const loaded = readFileWithBackup(getConfigPath(), parseConfigFile)
  if (!loaded) return null
  const config = loaded.value

  // One-time migration: replace Windows hotkey defaults that never worked on macOS
  if (isMac && !config.hotkeys_migrated_macos) {
    let changed = false
    if (config.quick_entry_hotkey === 'Alt+Shift+V') {
      config.quick_entry_hotkey = DEFAULT_QUICK_ENTRY_HOTKEY
      changed = true
    }
    if (config.quick_view_hotkey === 'Alt+Shift+B') {
      config.quick_view_hotkey = DEFAULT_QUICK_VIEW_HOTKEY
      changed = true
    }
    config.hotkeys_migrated_macos = true
    if (changed) {
      try {
        saveConfig(config)
      } catch (err) {
        console.warn('[Config] Could not save the hotkey migration:', err instanceof Error ? err.message : err)
      }
    }
  }

  return config
}

function normalizeReview(raw: unknown): ReviewConfig {
  const src = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  const n = Number(src.default_cadence_days)
  const cadence = Number.isFinite(n) ? Math.min(365, Math.max(1, Math.round(n))) : 14
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : true,
    default_cadence_days: cadence,
    exclude_inbox: typeof src.exclude_inbox === 'boolean' ? src.exclude_inbox : true,
  }
}

export function normalizeConfig(raw: Record<string, unknown>): AppConfig {
  return {
    vikunja_url: typeof raw.vikunja_url === 'string'
      ? raw.vikunja_url.replace(/\/+$/, '')
      : DEFAULT_CONFIG.vikunja_url,
    api_token: typeof raw.api_token === 'string'
      ? raw.api_token
      : DEFAULT_CONFIG.api_token,
    inbox_project_id: typeof raw.inbox_project_id === 'number'
      ? raw.inbox_project_id
      : DEFAULT_CONFIG.inbox_project_id,
    auth_method: raw.auth_method === 'oidc' ? 'oidc' : raw.auth_method === 'password' ? 'password' : 'api_token',
    theme: raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'system'
      ? raw.theme
      : DEFAULT_CONFIG.theme,
    window_bounds: isWindowBounds(raw.window_bounds) ? raw.window_bounds : undefined,
    sidebar_width: typeof raw.sidebar_width === 'number' ? raw.sidebar_width : undefined,
    custom_lists: Array.isArray(raw.custom_lists) ? raw.custom_lists as AppConfig['custom_lists'] : undefined,
    custom_lists_sync: raw.custom_lists_sync && typeof raw.custom_lists_sync === 'object'
      ? raw.custom_lists_sync as AppConfig['custom_lists_sync']
      : undefined,
    // Quick Entry / Quick View
    quick_entry_enabled: raw.quick_entry_enabled === true,
    quick_view_enabled: raw.quick_view_enabled === true,
    quick_entry_hotkey: typeof raw.quick_entry_hotkey === 'string' ? raw.quick_entry_hotkey : DEFAULT_QUICK_ENTRY_HOTKEY,
    quick_view_hotkey: typeof raw.quick_view_hotkey === 'string' ? raw.quick_view_hotkey : DEFAULT_QUICK_VIEW_HOTKEY,
    quick_entry_default_project_id: typeof raw.quick_entry_default_project_id === 'number'
      ? raw.quick_entry_default_project_id : undefined,
    exclamation_today: raw.exclamation_today !== false,
    project_cycle_modifier: raw.project_cycle_modifier === 'alt' || raw.project_cycle_modifier === 'ctrl+alt'
      ? raw.project_cycle_modifier : 'ctrl',
    secondary_projects: Array.isArray(raw.secondary_projects)
      ? raw.secondary_projects as SecondaryProject[] : [],
    quick_entry_position: isPosition(raw.quick_entry_position) ? raw.quick_entry_position : undefined,
    quick_view_position: isPosition(raw.quick_view_position) ? raw.quick_view_position : undefined,
    viewer_filter: isViewerFilter(raw.viewer_filter) ? raw.viewer_filter : {
      project_ids: [],
      sort_by: 'due_date',
      order_by: 'asc',
      due_date_filter: 'all',
      include_today_all_projects: false,
    },
    launch_on_startup: raw.launch_on_startup === true,
    standalone_mode: raw.standalone_mode === true,
    show_today_overdue_badge: raw.show_today_overdue_badge === true,
    // Obsidian
    obsidian_mode: raw.obsidian_mode === 'off' || raw.obsidian_mode === 'always' ? raw.obsidian_mode : 'ask',
    obsidian_api_key: typeof raw.obsidian_api_key === 'string' ? raw.obsidian_api_key : '',
    obsidian_port: typeof raw.obsidian_port === 'number' ? raw.obsidian_port : 27124,
    obsidian_vault_name: typeof raw.obsidian_vault_name === 'string' ? raw.obsidian_vault_name : '',
    // Browser
    browser_link_mode: raw.browser_link_mode === 'ask' || raw.browser_link_mode === 'always' ? raw.browser_link_mode : 'off',
    browser_extension_id: typeof raw.browser_extension_id === 'string' ? raw.browser_extension_id : '',
    // Notifications
    notifications_enabled: raw.notifications_enabled === true,
    notifications_persistent: raw.notifications_persistent === true,
    notifications_daily_reminder_enabled: raw.notifications_daily_reminder_enabled !== false,
    notifications_daily_reminder_time: typeof raw.notifications_daily_reminder_time === 'string'
      ? raw.notifications_daily_reminder_time : '08:00',
    notifications_secondary_reminder_enabled: raw.notifications_secondary_reminder_enabled === true,
    notifications_secondary_reminder_time: typeof raw.notifications_secondary_reminder_time === 'string'
      ? raw.notifications_secondary_reminder_time : '16:00',
    notifications_overdue_enabled: raw.notifications_overdue_enabled !== false,
    notifications_due_today_enabled: raw.notifications_due_today_enabled !== false,
    notifications_upcoming_enabled: raw.notifications_upcoming_enabled === true,
    notifications_sound: raw.notifications_sound !== false,
    // Task reminder settings
    notifications_task_reminder_sound: raw.notifications_task_reminder_sound !== false,
    notifications_task_reminder_persistent: raw.notifications_task_reminder_persistent === true,
    notifications_default_reminder_offset: typeof raw.notifications_default_reminder_offset === 'number'
      ? raw.notifications_default_reminder_offset : 0,
    notifications_default_reminder_relative_to: raw.notifications_default_reminder_relative_to === 'start_date'
      || raw.notifications_default_reminder_relative_to === 'end_date'
      ? raw.notifications_default_reminder_relative_to : 'due_date',
    // Update checker
    update_check_dismissed_version: typeof raw.update_check_dismissed_version === 'string'
      ? raw.update_check_dismissed_version : undefined,
    // Migration flags
    hotkeys_migrated_macos: raw.hotkeys_migrated_macos === true,
    // NLP task parser
    nlp_enabled: raw.nlp_enabled !== false,
    nlp_syntax_mode: raw.nlp_syntax_mode === 'vikunja' ? 'vikunja' : 'todoist',
    confirm_before_delete: raw.confirm_before_delete !== false,
    subtask_display: raw.subtask_display === 'expandable' ? 'expandable' : 'inside_task',
    // Task completion sound
    task_completion_sound_enabled: raw.task_completion_sound_enabled !== false,
    task_completion_sound_path: typeof raw.task_completion_sound_path === 'string'
      ? raw.task_completion_sound_path : null,
    last_file_dialog_directory: typeof raw.last_file_dialog_directory === 'string'
      ? raw.last_file_dialog_directory : null,
    last_username: typeof raw.last_username === 'string' ? raw.last_username : undefined,
    urgency_mode: raw.urgency_mode === 'important' ? 'important' : 'today',
    last_used_project_id: typeof raw.last_used_project_id === 'number' ? raw.last_used_project_id : undefined,
    last_used_label_id: typeof raw.last_used_label_id === 'number' ? raw.last_used_label_id : undefined,
    review: normalizeReview(raw.review),
  }
}

function isPosition(v: unknown): v is { x: number; y: number } {
  if (!v || typeof v !== 'object') return false
  const p = v as Record<string, unknown>
  return typeof p.x === 'number' && typeof p.y === 'number'
}

function isViewerFilter(v: unknown): v is ViewerFilter {
  if (!v || typeof v !== 'object') return false
  const f = v as Record<string, unknown>
  return Array.isArray(f.project_ids) && typeof f.sort_by === 'string'
}

function isWindowBounds(v: unknown): v is { x: number; y: number; width: number; height: number } {
  if (!v || typeof v !== 'object') return false
  const b = v as Record<string, unknown>
  return (
    typeof b.x === 'number' &&
    typeof b.y === 'number' &&
    typeof b.width === 'number' &&
    typeof b.height === 'number'
  )
}

export function saveConfig(config: AppConfig): void {
  cachedConfig = structuredClone(config)
  // Temp file + rename, keeping config.json.bak (see atomic-file.ts)
  writeFileAtomic(getConfigPath(), JSON.stringify(config, null, 2), { backup: true })
}

// --- Merging renderer changes into the current config -----------------------
//
// The renderer must never replace the whole config: it only holds a snapshot, and
// main keeps changing fields of its own (window bounds, sidebar width, popup
// positions, last dialog directory, dismissed update version, custom lists...).
// These helpers merge a narrow change into the config as it is *now*.

export type AuthMethod = NonNullable<AppConfig['auth_method']>

/** The fields a setup, login or disconnect flow is allowed to change. */
export interface ConnectionFields {
  vikunja_url: string
  api_token: string
  auth_method: AuthMethod
  /** Omit to keep the current inbox on the same server (0 on a different one). */
  inbox_project_id?: number
}

/** Data that belongs to one server/account: IDs and state that mean nothing elsewhere. */
const ACCOUNT_SPECIFIC_KEYS = [
  'custom_lists',
  'custom_lists_sync',
  'quick_entry_default_project_id',
  'secondary_projects',
  'viewer_filter',
  'standalone_mode',
  'last_used_project_id',
  'last_used_label_id',
  'last_username',
] as const satisfies readonly (keyof AppConfig)[]

/** Owned by the custom list service (its own IPCs and sync); never taken from a renderer patch. */
const MAIN_OWNED_KEYS: ReadonlySet<string> = new Set(['custom_lists', 'custom_lists_sync'])

/** Every key of AppConfig, derived from the normalizer so the two cannot drift apart. */
const CONFIG_KEYS: ReadonlySet<string> = new Set(Object.keys(normalizeConfig({})))

function trimUrl(url: unknown): string {
  return typeof url === 'string' ? url.replace(/\/+$/, '') : ''
}

function resetAccountData(config: Record<string, unknown>): void {
  for (const key of ACCOUNT_SPECIFIC_KEYS) config[key] = undefined
}

/**
 * Apply a connection change (setup, OIDC/password login, disconnect) to the
 * existing config. Only the connection fields change. Switching to another server
 * also drops the previous account's data; every preference (theme, hotkeys,
 * notifications, quick entry, sounds...) is kept.
 */
export function applyConnectionFields(existing: AppConfig | null, conn: ConnectionFields): AppConfig {
  const url = trimUrl(conn.vikunja_url)
  const sameServer = existing !== null && trimUrl(existing.vikunja_url) === url
  const merged: Record<string, unknown> = {
    ...(existing ?? {}),
    vikunja_url: url,
    api_token: conn.api_token,
    auth_method: conn.auth_method,
    inbox_project_id: conn.inbox_project_id ?? (sameServer ? existing.inbox_project_id : 0),
  }
  if (!sameServer) resetAccountData(merged)
  return normalizeConfig(merged)
}

/**
 * Merge a partial change from the renderer into the current config. Only known
 * keys are taken, and never the custom list slice. A key whose value is
 * undefined is reset to its default. Values are replaced at the top level (a
 * patched `review` or `viewer_filter` object replaces the old one). Pointing
 * `vikunja_url` at another server drops the previous account's data.
 */
export function applyConfigPatch(current: AppConfig, patch: Record<string, unknown>): AppConfig {
  const merged: Record<string, unknown> = { ...current }
  for (const key of Object.keys(patch)) {
    if (!CONFIG_KEYS.has(key) || MAIN_OWNED_KEYS.has(key)) continue
    merged[key] = patch[key]
  }
  if (trimUrl(merged.vikunja_url) !== trimUrl(current.vikunja_url)) resetAccountData(merged)
  return normalizeConfig(merged)
}

/** Shape check for connection fields arriving over IPC. */
export function isConnectionFields(v: unknown): v is ConnectionFields {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  return (
    typeof c.vikunja_url === 'string' &&
    typeof c.api_token === 'string' &&
    (c.auth_method === 'api_token' || c.auth_method === 'oidc' || c.auth_method === 'password') &&
    (c.inbox_project_id === undefined || (typeof c.inbox_project_id === 'number' && Number.isFinite(c.inbox_project_id)))
  )
}
