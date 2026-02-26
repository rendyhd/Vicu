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
  created_by: { id: number; username: string }
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
  due_date?: string
  start_date?: string
  priority?: number
  labels?: { id: number }[]
  reminders?: TaskReminder[]
  repeat_after?: number
  repeat_mode?: number
}

export interface UpdateTaskPayload extends Partial<Task> {}

export interface CreateProjectPayload {
  title: string
  description?: string
  parent_project_id?: number
  hex_color?: string
}

export interface UpdateProjectPayload {
  title?: string
  description?: string
  hex_color?: string
  is_archived?: boolean
  position?: number
  parent_project_id?: number
}

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
  s?: string
  filter?: string
  sort_by?: string
  order_by?: string
  filter_include_nulls?: boolean
  filter_timezone?: string
}

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export interface CustomListFilter {
  project_ids: number[]
  sort_by: 'due_date' | 'priority' | 'created' | 'updated' | 'title'
  order_by: 'asc' | 'desc'
  due_date_filter: 'all' | 'overdue' | 'today' | 'this_week' | 'this_month' | 'has_due_date' | 'no_due_date'
  priority_filter?: number[]
  label_ids?: number[]
  include_done?: boolean
  include_today_all_projects?: boolean
}

export interface CustomList {
  id: string
  name: string
  icon?: string
  filter: CustomListFilter
}

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
  auth_method?: 'api_token' | 'oidc' | 'password'
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
  // Obsidian
  obsidian_mode?: 'off' | 'ask' | 'always'
  obsidian_api_key?: string
  obsidian_port?: number
  obsidian_vault_name?: string
  // Browser
  browser_link_mode?: 'off' | 'ask' | 'always'
  browser_extension_id?: string
  // NLP task parser
  nlp_enabled?: boolean
  nlp_syntax_mode?: 'todoist' | 'vikunja'
}
