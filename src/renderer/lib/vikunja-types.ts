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

// Config shapes are shared with the main process (src/shared/config-types.ts).
export type {
  AppConfig,
  AuthMethod,
  CustomList,
  CustomListFilter,
  CustomListSortField,
  CustomListSyncStatus,
  ReviewConfig,
  SecondaryProject,
  ViewerFilter,
} from '../../shared/config-types'
export {
  CUSTOM_LIST_SORT_FIELDS,
  isQuickEntryEnabled,
  isQuickViewEnabled,
  isRoutinesEnabled,
  showRoutinesInToday,
} from '../../shared/config-types'
import type { ConnectionFields } from '../../shared/config-types'

/**
 * What a setup, login or disconnect flow may change. Everything else in the config
 * (preferences, hotkeys, window state...) is kept by the main process.
 */
export type ConnectionConfig = ConnectionFields

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
