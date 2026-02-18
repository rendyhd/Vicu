import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

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

export interface AppConfig {
  vikunja_url: string
  api_token: string
  inbox_project_id: number
  auth_method?: 'api_token' | 'oidc'
  theme: 'light' | 'dark' | 'system'
  window_bounds?: { x: number; y: number; width: number; height: number }
  sidebar_width?: number
  custom_lists?: Array<{
    id: string
    name: string
    icon?: string
    filter: {
      project_ids: number[]
      sort_by: string
      order_by: string
      due_date_filter: string
      priority_filter?: number[]
      label_ids?: number[]
      include_done?: boolean
      include_today_all_projects?: boolean
    }
  }>
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
}

const CONFIG_FILENAME = 'config.json'

const DEFAULT_CONFIG: AppConfig = {
  vikunja_url: '',
  api_token: '',
  inbox_project_id: 0,
  theme: 'system',
}

function getConfigPath(): string {
  return join(app.getPath('userData'), CONFIG_FILENAME)
}

export function loadConfig(): AppConfig | null {
  const configPath = getConfigPath()

  if (!existsSync(configPath)) {
    return null
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(raw)
    return normalizeConfig(parsed)
  } catch {
    return null
  }
}

function normalizeConfig(raw: Record<string, unknown>): AppConfig {
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
    auth_method: raw.auth_method === 'oidc' ? 'oidc' : 'api_token',
    theme: raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'system'
      ? raw.theme
      : DEFAULT_CONFIG.theme,
    window_bounds: isWindowBounds(raw.window_bounds) ? raw.window_bounds : undefined,
    sidebar_width: typeof raw.sidebar_width === 'number' ? raw.sidebar_width : undefined,
    custom_lists: Array.isArray(raw.custom_lists) ? raw.custom_lists as AppConfig['custom_lists'] : undefined,
    // Quick Entry / Quick View
    quick_entry_enabled: raw.quick_entry_enabled === true,
    quick_view_enabled: raw.quick_view_enabled !== false,
    quick_entry_hotkey: typeof raw.quick_entry_hotkey === 'string' ? raw.quick_entry_hotkey : 'Alt+Shift+V',
    quick_view_hotkey: typeof raw.quick_view_hotkey === 'string' ? raw.quick_view_hotkey : 'Alt+Shift+B',
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
  const configPath = getConfigPath()
  const dir = dirname(configPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}
