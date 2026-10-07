import type { DueWindow } from './due-dates'
import type { ProjectPatch, TaskPatch } from './merge-patches'

export interface TaskReminder {
  reminder: string          // absolute ISO timestamp
  relative_period?: number  // seconds relative to relative_to date
  relative_to?: 'due_date' | 'start_date' | 'end_date'
}

export interface TaskFile {
  id: number
  name: string
  size: number
  mime: string
  created: string
}

export interface TaskAttachment {
  id: number
  task_id: number
  created: string
  created_by: { id: number; username: string }
  file: TaskFile
}

export interface Task {
  id: number
  title: string
  description: string
  done: boolean
  done_at: string
  due_date: string
  start_date: string
  end_date: string
  priority: number // 0=unset, 1=low, 2=medium, 3=high, 4=urgent
  project_id: number
  labels: Label[] | null
  reminders: TaskReminder[] | null
  attachments?: TaskAttachment[] | null
  related_tasks?: Record<string, Task[]> | null
  created: string
  updated: string
  created_by: { id: number; username: string; name?: string }
  identifier: string
  position: number
  bucket_id: number
  percent_done: number
  repeat_after: number
  repeat_mode: number // 0=default, 1=monthly, 2=from current date
  hex_color: string
}

export interface Project {
  id: number
  title: string
  description: string
  parent_project_id: number
  is_archived: boolean
  hex_color: string
  position: number
  created: string
  updated: string
}

export interface Label {
  id: number
  title: string
  hex_color: string
  created: string
  updated: string
}

export interface ProjectView {
  id: number
  project_id: number
  title: string
  view_kind: 'list' | 'gantt' | 'table' | 'kanban'
  position: number
  created: string
  updated: string
}

export interface CreateTaskPayload {
  title: string
  description?: string
  /** Create the task already completed (routine carriers and archive parts, one call). */
  done?: boolean
  due_date?: string
  start_date?: string
  priority?: number
  labels?: { id: number }[]
  reminders?: TaskReminder[]
  repeat_after?: number
  repeat_mode?: number
}

/**
 * Wire format of `PATCH /tasks/{id}`: only the writable fields that changed
 * (build it with `taskPatch`). Never a whole cached task.
 */
export type UpdateTaskPayload = TaskPatch

export interface CreateProjectPayload {
  title: string
  description?: string
  parent_project_id?: number
  hex_color?: string
}

/**
 * Wire format of `PATCH /projects/{id}`: only the writable fields that changed
 * (build it with `projectPatch`). Never a project tree node.
 */
export type UpdateProjectPayload = ProjectPatch

export interface CreateLabelPayload {
  title: string
  hex_color?: string
}

export interface UpdateLabelPayload {
  title?: string
  hex_color?: string
}

export interface TaskQueryParams {
  page?: number
  per_page?: number
  q?: string
  filter?: string
  sort_by?: string
  order_by?: string
  filter_include_nulls?: boolean
  filter_timezone?: string
  /**
   * Vicu option, never sent to the server: keep nested subtasks in the result so the view can
   * filter first and hide them afterwards (Tag view, custom lists).
   */
  keep_nested_subtasks?: boolean
  /**
   * Vicu option, never sent to the server: add the due-date clause of the Today or Upcoming list,
   * built in the main process from the local-day boundary at request time.
   */
  due_window?: DueWindow
}

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export interface CustomListFilter {
  project_ids: number[]
  project_filter_mode?: 'include' | 'exclude'
  /** 0 resolves to the configured Inbox. */
  add_to_project_id?: number
  sort_by: 'due_date' | 'priority' | 'created' | 'updated' | 'title'
  order_by: 'asc' | 'desc'
  due_date_filter: 'all' | 'overdue' | 'today' | 'this_week' | 'this_month' | 'has_due_date' | 'no_due_date'
  priority_filter?: number[]
  label_ids?: number[]
  include_done?: boolean
  include_today_all_projects?: boolean
  /** Whether the today / this week / this month windows also include overdue tasks. Absent means true. */
  include_overdue?: boolean
}

export interface CustomList {
  id: string
  name: string
  icon?: string
  filter: CustomListFilter
}

export type CustomListSyncStatus =
  | { state: 'idle'; last_synced_at?: string }
  | { state: 'syncing' }
  | { state: 'pending'; message?: string }
  | { state: 'offline'; message: string }
  | { state: 'error'; message: string }
  | { state: 'update_required'; message: string }
  | { state: 'local_only' }

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
  /** The username of the last password login; shown on the sign-in screen. */
  last_username?: string
  theme: 'light' | 'dark' | 'system'
  window_bounds?: { x: number; y: number; width: number; height: number }
  sidebar_width?: number
  custom_lists?: CustomList[]
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
  notifications_default_reminder_offset?: number
  notifications_default_reminder_relative_to?: 'due_date' | 'start_date' | 'end_date'
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
  // Update checker
  update_check_dismissed_version?: string
  // Task context menu
  urgency_mode?: 'today' | 'important'
  last_used_project_id?: number
  last_used_label_id?: number
  // Project review
  review?: ReviewConfig
}

/**
 * What a setup, login or disconnect flow may change. Everything else in the config
 * (preferences, hotkeys, window state...) is kept by the main process.
 */
export interface ConnectionConfig {
  vikunja_url: string
  api_token: string
  auth_method: 'api_token' | 'oidc' | 'password'
  /** Omit to keep the current inbox on the same server (0 on a different one). */
  inbox_project_id?: number
}

export interface OIDCProvider {
  name: string
  key: string
  auth_url: string
  client_id: string
  scope: string
}

export interface ServerAuthInfo {
  local_enabled: boolean
  oidc_enabled: boolean
  oidc_providers: OIDCProvider[]
  totp_enabled: boolean
}

export type PasswordLoginResult =
  | { success: true; token: string }
  | { success: false; error: string; totpRequired?: boolean }

export interface VikunjaUser {
  id: number
  username: string
  email: string
  name: string
}

export type AuthCheckResult =
  | { status: 'authenticated' }
  | { status: 'reauth-needed'; authMethod: string; vikunjaUrl: string; lastUsername?: string }
  | { status: 'unconfigured' }
