declare global {
  interface Window {
    quickViewApi: {
      fetchTasks(): Promise<FetchResult>
      // A row id is a number, a `local_x` string (standalone) or `pending_x` (queued offline).
      markTaskDone(taskId: number | string, taskData: Record<string, unknown>): Promise<ActionResult>
      markTaskUndone(taskId: number | string, taskData: Record<string, unknown>): Promise<ActionResult>
      scheduleTaskToday(taskId: number | string, taskData: Record<string, unknown>): Promise<ActionResult>
      removeDueDate(taskId: number | string, taskData: Record<string, unknown>): Promise<ActionResult>
      updateTask(taskId: number | string, patch: TaskPatch): Promise<ActionResult>
      openTaskInBrowser(taskId: number): Promise<void>
      openTaskInApp(taskId: number): Promise<void>
      closeWindow(): Promise<void>
      setHeight(height: number): Promise<void>
      getPendingCount(): Promise<number>
      getQueueCounts(): Promise<{ pending: number; failed: number }>
      getConfig(): Promise<QuickViewConfig | null>
      // The locale and clock dates are phrased with (system locale, Settings clock choice).
      getDateFormat(): Promise<{ locale: string; hour12: boolean }>
      onDateFormatChanged(callback: (format: { locale: string; hour12: boolean }) => void): void
      onShowWindow(callback: () => void): void
      onHideWindow(callback: () => void): void
      onSyncCompleted(callback: () => void): void
      onConfigChanged(callback: () => void): void
      onDragHover(callback: (hovering: boolean) => void): void
      openDeepLink(url: string): Promise<void>
    }
  }
}

interface TaskData {
  id: number | string
  title: string
  description: string
  due_date: string
  priority: number
  done: boolean
  created: string
  updated: string
  [key: string]: unknown
}

interface FetchResult {
  success: boolean
  tasks?: TaskData[]
  error?: string
  cached?: boolean
  cachedAt?: string
  standalone?: boolean
}

interface ActionResult {
  success: boolean
  task?: TaskData
  error?: string
  cached?: boolean
  cancelledPending?: boolean
}

interface QuickViewConfig {
  standalone_mode: boolean
}

import { extractTaskLink, stripNoteLink, stripPageLink, extractNoteLinkHtml, extractPageLinkHtml } from '@/lib/note-link'
import { sanitizeTaskHtml } from '@/lib/sanitize-html'
import { taskPatch, type TaskPatch } from '@/lib/merge-patches'
import { diffLocalDays, dueToday, isDateOnly, isNoDueDate, toLocalDate } from '@/lib/due-dates'
import { followColorScheme } from '@/lib/theme'
import { formatDateDisplay } from '@/lib/date-display'
import { getDateFormat, initDateFormat, subscribeDateFormat } from '@/lib/date-format'
import { priorityMarkSvg } from '../../shared/priority-mark-svg'
import {
  hasRichDescriptionBody,
  plainTextFromDescriptionLines,
  plainTextToDescriptionHtml,
  resolveOpenableDescriptionHref,
  withLineBreaksAsNewlines,
} from '@/lib/description-html'

// The notes as the text box shows them: one line per paragraph (and per <br>), where textContent
// alone would run the paragraphs together.
function plainTextFromHtml(html: string): string {
  const tmp = document.createElement('div')
  tmp.innerHTML = sanitizeTaskHtml(withLineBreaksAsNewlines(html))
  return plainTextFromDescriptionLines(tmp.textContent ?? '')
}

followColorScheme()

const container = document.getElementById('container')!
const taskList = document.getElementById('task-list')!
const errorMessage = document.getElementById('error-message')!
const statusBar = document.getElementById('status-bar')!
const dragHandle = document.querySelector('.drag-handle')!

let errorTimeout: ReturnType<typeof setTimeout> | null = null
let selectedIndex = -1
let isStandaloneMode = false
let lastFetchResult: FetchResult | null = null
let lastFetchTime = 0
let isWindowVisible = false
const CACHE_TTL_MS = 30000
const completedTasks = new Map<string, TaskData>()
const cachedCompletions = new Set<string>()

function unfinishedDescendants(task: TaskData): TaskData[] {
  const result: TaskData[] = []
  const visited = new Set<number | string>([task.id])

  const visit = (parent: TaskData) => {
    const related = parent.related_tasks as Record<string, TaskData[]> | null | undefined
    for (const child of related?.subtask ?? []) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      if (!child.done) result.push(child)
      visit(child)
    }
  }

  visit(task)
  return result
}

function measureContentHeight(): number {
  let height = 2
  const dh = container.querySelector('.drag-handle')
  if (dh) height += (dh as HTMLElement).offsetHeight
  if (!statusBar.classList.contains('hidden')) height += statusBar.offsetHeight
  for (const child of taskList.children) height += (child as HTMLElement).offsetHeight
  if (!errorMessage.hidden) height += errorMessage.offsetHeight
  return height
}

function notifyHeight(): void {
  window.quickViewApi.setHeight(measureContentHeight())
}

function showError(msg: string): void {
  errorMessage.textContent = msg
  errorMessage.hidden = false
  void errorMessage.offsetHeight
  errorMessage.classList.add('show')
  if (errorTimeout) clearTimeout(errorTimeout)
  errorTimeout = setTimeout(() => {
    errorMessage.classList.remove('show')
    setTimeout(() => { errorMessage.hidden = true }, 200)
  }, 3000)
}

function showStatusBar(text: string, type?: string): void {
  statusBar.textContent = text
  statusBar.className = 'status-bar ' + (type || '')
  statusBar.classList.remove('hidden')
}

function hideStatusBar(): void {
  statusBar.classList.add('hidden')
}

function formatRelativeTime(isoString: string | null | undefined): string {
  if (!isoString) return ''
  const diff = Date.now() - new Date(isoString).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function getTaskItems(): NodeListOf<HTMLElement> {
  return taskList.querySelectorAll('.task-item')
}

function updateSelection(newIndex: number): void {
  const items = getTaskItems()
  if (items.length === 0) return
  if (newIndex < 0) newIndex = items.length - 1
  if (newIndex >= items.length) newIndex = 0
  items.forEach((item) => item.classList.remove('selected'))
  selectedIndex = newIndex
  items[selectedIndex].classList.add('selected')
  items[selectedIndex].scrollIntoView({ block: 'nearest' })
}

// Buckets follow the local calendar date (cross-app semantics v1): a task due at 08:00 today
// is still "Today" at 10:00 and becomes overdue tomorrow. The text is the `row` phrasing of the
// contract (section 8): "Yesterday", "3 days ago", "Fri", "27 Sep", with the time when it has one.
function formatDueDate(dueDateStr: string | null | undefined): { label: string; cssClass: string } | null {
  if (isNoDueDate(dueDateStr)) return null

  const due = new Date(dueDateStr as string)
  const now = new Date()
  const diffDays = diffLocalDays(toLocalDate(now), toLocalDate(due))

  const label = formatDateDisplay('row', due, now, isDateOnly(dueDateStr as string), getDateFormat())
  const cssClass = diffDays < 0 ? 'overdue' : diffDays === 0 ? 'today' : 'upcoming'

  return { label, cssClass }
}

function buildTaskItemDOM(task: TaskData): HTMLElement {
  const item = document.createElement('div')
  item.className = 'task-item'
  item.dataset.taskId = String(task.id)
  item.dataset.task = JSON.stringify(task)

  const checkbox = document.createElement('input') as HTMLInputElement
  checkbox.type = 'checkbox'
  checkbox.className = 'task-checkbox'
  checkbox.title = 'Mark as done'
  checkbox.addEventListener('change', () => completeTask(task.id, item, checkbox))
  // A list that includes completed tasks shows them checked; they cannot be completed again.
  if (task.done) {
    item.classList.add('task-done')
    checkbox.checked = true
    checkbox.disabled = true
    checkbox.title = 'Completed'
  }
  item.appendChild(checkbox)

  const content = document.createElement('div')
  content.className = 'task-content'

  const titleRow = document.createElement('div')
  titleRow.className = 'task-title-row'

  const title = document.createElement('div')
  title.className = 'task-title' + (isStandaloneMode ? ' standalone' : '')
  title.textContent = task.title
  if (!isStandaloneMode) {
    title.addEventListener('click', (e) => {
      e.stopPropagation()
      // A task that only exists in the offline queue has no page on the server yet.
      if (typeof task.id === 'number') window.quickViewApi.openTaskInBrowser(task.id)
    })
  }
  titleRow.appendChild(title)

  const taskLink = extractTaskLink(task.description)
  if (taskLink) {
    const btn = document.createElement('button')
    btn.className = taskLink.kind === 'note' ? 'obsidian-link-btn' : 'browser-link-btn'
    btn.title = taskLink.kind === 'note' ? `Open "${taskLink.name}" in Obsidian` : `Open "${taskLink.title}"`
    btn.innerHTML = taskLink.kind === 'note'
      ? `<svg width="12" height="12" viewBox="0 0 100 100"><path d="M68.6 2.2 32.8 19.8a4 4 0 0 0-2.2 2.7L18.2 80.1a4 4 0 0 0 1 3.7l16.7 16a4 4 0 0 0 3.6 1.1l42-9.6a4 4 0 0 0 2.8-2.3L97.7 46a4 4 0 0 0-.5-3.8L72.3 3a4 4 0 0 0-3.7-1.8z" fill="currentColor"/></svg>`
      : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      window.quickViewApi.openDeepLink(taskLink.url)
    })
    titleRow.appendChild(btn)
  }

  if (task.description) {
    const descIcon = document.createElement('span')
    descIcon.className = 'description-icon'
    descIcon.title = 'Toggle description'
    descIcon.textContent = '\u2261'
    descIcon.addEventListener('mousedown', (e) => {
      e.stopPropagation()
      const desc = item.querySelector('.task-description')
      if (desc) {
        desc.classList.toggle('hidden')
        notifyHeight()
      }
    })
    titleRow.appendChild(descIcon)
  }

  content.appendChild(titleRow)

  const dueInfo = formatDueDate(task.due_date)
  if (dueInfo) {
    const due = document.createElement('div')
    due.className = `task-due ${dueInfo.cssClass}`
    due.textContent = dueInfo.label
    content.appendChild(due)
  }

  if (task.description) {
    const desc = document.createElement('div')
    desc.className = 'task-description task-description-rich hidden'
    desc.innerHTML = sanitizeTaskHtml(stripPageLink(stripNoteLink(task.description)))
    desc.addEventListener('click', (e) => {
      e.stopPropagation()
      // A link opens in the default handler. Without preventDefault the window would navigate
      // to it (the navigation guard only rescues the page); links with a scheme that may not
      // be opened do nothing.
      const anchor = (e.target as HTMLElement | null)?.closest?.('a')
      if (anchor && desc.contains(anchor)) {
        e.preventDefault()
        const href = resolveOpenableDescriptionHref(anchor.getAttribute('href'))
        if (href) void window.quickViewApi.openDeepLink(href)
        return
      }
      const items = getTaskItems()
      const index = Array.from(items).indexOf(item)
      if (index >= 0) updateSelection(index)
      enterEditMode(true)
    })
    content.appendChild(desc)
  }

  item.appendChild(content)
  // The priority mark closes the row (the shared SVG, drawn in the priority role colour).
  const markSvg = priorityMarkSvg(task.priority)
  if (markSvg) {
    const mark = document.createElement('span')
    mark.className = `task-priority priority-${Math.min(task.priority, 5)}`
    mark.innerHTML = markSvg
    item.appendChild(mark)
  }
  return item
}

function toggleSelectedDescription(): void {
  const items = getTaskItems()
  if (selectedIndex < 0 || selectedIndex >= items.length) return
  const item = items[selectedIndex]
  const desc = item.querySelector('.task-description')
  if (!desc) return
  desc.classList.toggle('hidden')
  notifyHeight()
}

function renderTasks(tasks: TaskData[]): void {
  taskList.innerHTML = ''
  completedTasks.clear()
  cachedCompletions.clear()
  selectedIndex = -1

  if (!tasks || tasks.length === 0) {
    taskList.innerHTML = '<div class="empty-state">No open tasks</div>'
    return
  }

  for (const task of tasks) {
    taskList.appendChild(buildTaskItemDOM(task))
  }

  updateSelection(0)
}

function showCompletedMessage(item: HTMLElement, taskId: number | string, wasCached: boolean): void {
  item.innerHTML = ''
  item.className = 'task-item completed-undo selected'
  item.dataset.taskId = String(taskId)

  const msg = document.createElement('span')
  msg.className = 'completed-message'
  msg.textContent = wasCached
    ? 'Queued offline \u2014 press Enter to undo'
    : 'Task completed \u2014 press Enter to undo'
  item.appendChild(msg)
}

async function completeTask(taskId: number | string, itemElement: HTMLElement, checkbox: HTMLInputElement | null): Promise<void> {
  const originalTask: TaskData = JSON.parse(itemElement.dataset.task || '{}')
  const autoCompletedSubtasks = unfinishedDescendants(originalTask)
  if (autoCompletedSubtasks.length > 0) {
    const ok = window.confirm(
      `Complete this task and ${autoCompletedSubtasks.length} unfinished ${autoCompletedSubtasks.length === 1 ? 'subtask' : 'subtasks'}?`,
    )
    if (!ok) {
      if (checkbox) checkbox.checked = false
      return
    }
  }
  if (checkbox) checkbox.disabled = true
  itemElement.classList.add('completing')

  const result = await window.quickViewApi.markTaskDone(taskId, originalTask)

  if (result.success) {
    lastFetchResult = null
    completedTasks.set(String(taskId), {
      ...originalTask,
      __vicu_auto_completed_subtasks: autoCompletedSubtasks,
    })
    const wasCached = !!result.cached
    if (wasCached) cachedCompletions.add(String(taskId))
    showCompletedMessage(itemElement, taskId, wasCached)
    notifyHeight()
  } else {
    showError(result.error || 'Failed to complete task')
    if (checkbox) { checkbox.checked = false; checkbox.disabled = false }
    itemElement.classList.remove('completing')
  }
}

async function undoComplete(taskId: number | string, itemElement: HTMLElement): Promise<void> {
  const storedTask = completedTasks.get(String(taskId))
  const result = await window.quickViewApi.markTaskUndone(taskId, storedTask || {})

  if (result.success) {
    lastFetchResult = null
    const taskData = storedTask || result.task || { id: taskId, title: 'Task' } as TaskData
    completedTasks.delete(String(taskId))
    cachedCompletions.delete(String(taskId))
    const newItem = buildTaskItemDOM(taskData)
    newItem.classList.add('selected')
    itemElement.replaceWith(newItem)
    notifyHeight()
  } else {
    showError(result.error || 'Failed to undo completion')
  }
}

async function toggleDueDate(): Promise<void> {
  const items = getTaskItems()
  if (selectedIndex < 0 || selectedIndex >= items.length) return
  const item = items[selectedIndex]
  if (item.classList.contains('completed-undo')) return

  const taskId = item.dataset.taskId!
  const taskData: TaskData = JSON.parse(item.dataset.task || '{}')
  const hasDueDate = taskData.due_date && taskData.due_date !== '0001-01-01T00:00:00Z'

  if (hasDueDate) {
    const result = await window.quickViewApi.removeDueDate(taskId, taskData)
    if (result.success) {
      lastFetchResult = null
      taskData.due_date = '0001-01-01T00:00:00Z'
      item.dataset.task = JSON.stringify(taskData)
      const dueEl = item.querySelector('.task-due')
      if (dueEl) dueEl.remove()
    } else {
      showError(result.error || 'Failed to remove due date')
    }
  } else {
    const result = await window.quickViewApi.scheduleTaskToday(taskId, taskData)
    if (result.success) {
      lastFetchResult = null
      taskData.due_date = dueToday()
      item.dataset.task = JSON.stringify(taskData)
      const content = item.querySelector('.task-content')
      let dueEl = item.querySelector('.task-due')
      if (dueEl) {
        dueEl.textContent = 'Today'
        dueEl.className = 'task-due today'
      } else if (content) {
        dueEl = document.createElement('div')
        dueEl.className = 'task-due today'
        dueEl.textContent = 'Today'
        const titleRow = content.querySelector('.task-title-row')
        if (titleRow && titleRow.nextSibling) {
          content.insertBefore(dueEl, titleRow.nextSibling)
        } else {
          content.appendChild(dueEl)
        }
      }
    } else {
      showError(result.error || 'Failed to schedule task')
    }
  }
}

// --- Inline Editing ---
let editingItem: HTMLElement | null = null

function enterEditMode(focusDescription = false): void {
  const items = getTaskItems()
  if (selectedIndex < 0 || selectedIndex >= items.length) return
  const item = items[selectedIndex]
  if (item.classList.contains('completed-undo') || item.classList.contains('editing')) return

  const taskData: TaskData = JSON.parse(item.dataset.task || '{}')
  const descriptionBody = stripPageLink(stripNoteLink(taskData.description || ''))
  const hasRichDescription = hasRichDescriptionBody(descriptionBody)
  // A task that only exists in the offline queue cannot be opened in the app yet.
  const canOpenInApp = typeof taskData.id === 'number'
  if (focusDescription && hasRichDescription && canOpenInApp) {
    void window.quickViewApi.openTaskInApp(taskData.id as number)
    return
  }
  editingItem = item
  item.classList.add('editing')

  item.innerHTML = ''
  const editWrapper = document.createElement('div')
  editWrapper.className = 'task-edit-wrapper'
  editWrapper.dataset.preserveRichDescription = String(hasRichDescription)

  const titleInput = document.createElement('input') as HTMLInputElement
  titleInput.type = 'text'
  titleInput.className = 'task-edit-title'
  titleInput.value = taskData.title || ''
  titleInput.placeholder = 'Task title'

  const descTextarea = document.createElement('textarea') as HTMLTextAreaElement
  descTextarea.className = 'task-edit-description'
  // Edit as plain text — rich formatting (if any) round-trips through the main window.
  descTextarea.value = plainTextFromHtml(descriptionBody)
  descTextarea.placeholder = hasRichDescription ? 'Open in Vicu to edit rich description' : 'Description (optional)'
  descTextarea.readOnly = hasRichDescription
  descTextarea.title = hasRichDescription ? 'Open the main Vicu window to edit rich formatting' : ''
  descTextarea.rows = 3

  editWrapper.appendChild(titleInput)
  editWrapper.appendChild(descTextarea)

  const hint = document.createElement('div')
  hint.className = 'task-edit-hint'
  hint.textContent = 'Enter to save \u00b7 Shift+Enter for new line \u00b7 Esc to cancel'
  if (hasRichDescription) {
    hint.textContent = 'Rich description is preserved · click it to edit in Vicu · Enter saves the title'
  }
  editWrapper.appendChild(hint)
  item.appendChild(editWrapper)

  titleInput.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(item, titleInput.value, descTextarea.value) }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(item) }
    else if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); descTextarea.focus() }
  })

  descTextarea.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (hasRichDescription && canOpenInApp && e.key === 'Enter') {
      e.preventDefault()
      void window.quickViewApi.openTaskInApp(taskData.id as number)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(item, titleInput.value, descTextarea.value) }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(item) }
    else if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); titleInput.focus() }
  })

  titleInput.addEventListener('keypress', (e) => e.stopPropagation())
  descTextarea.addEventListener('keypress', (e) => e.stopPropagation())
  if (hasRichDescription && canOpenInApp) {
    descTextarea.addEventListener('click', () => {
      void window.quickViewApi.openTaskInApp(taskData.id as number)
    })
  }

  if (focusDescription) {
    descTextarea.focus()
    descTextarea.selectionStart = descTextarea.selectionEnd = descTextarea.value.length
  } else {
    titleInput.focus()
    titleInput.select()
  }
  notifyHeight()
}

async function saveEdit(item: HTMLElement, newTitle: string, newDescription: string): Promise<void> {
  const trimmedTitle = newTitle.trim()
  if (!trimmedTitle) { showError('Title cannot be empty'); return }

  const taskId = item.dataset.taskId!
  const taskData: TaskData = JSON.parse(item.dataset.task || '{}')
  // User typed plain text — wrap as <p>…</p> for Vikunja and re-attach preserved link comments.
  const preserveRichDescription = item.querySelector<HTMLElement>('.task-edit-wrapper')?.dataset.preserveRichDescription === 'true'
  let finalDescription = taskData.description || ''
  if (!preserveRichDescription) {
    // Notes that were not edited keep their stored HTML exactly; edited text is written the way
    // every plain-text box writes it (escaped, one <p> per line).
    const original = plainTextFromHtml(stripPageLink(stripNoteLink(taskData.description || '')))
    if (plainTextFromDescriptionLines(newDescription) !== original) {
      const linkHtml = extractNoteLinkHtml(taskData.description) + extractPageLinkHtml(taskData.description)
      finalDescription = plainTextToDescriptionHtml(newDescription) + linkHtml
    }
  }
  // Send only what changed so a stale cached row cannot revert other edits (D-REN-2).
  const patch = taskPatch(taskData, { title: trimmedTitle, description: finalDescription })
  const result: ActionResult = Object.keys(patch).length === 0
    ? { success: true }
    : await window.quickViewApi.updateTask(taskId, patch)

  if (result.success) {
    lastFetchResult = null
    taskData.title = trimmedTitle
    taskData.description = finalDescription
    item.dataset.task = JSON.stringify(taskData)
    exitEditMode(item)
    const newItem = buildTaskItemDOM(taskData)
    newItem.classList.add('selected')
    newItem.dataset.taskId = item.dataset.taskId!
    newItem.dataset.task = item.dataset.task!
    item.replaceWith(newItem)
    editingItem = null
    notifyHeight()
  } else {
    showError(result.error || 'Failed to update task')
  }
}

// The row is built again from the task it carries, like after a save. Putting the old markup
// back with innerHTML would drop every listener (checkbox, title, link and description clicks).
function cancelEdit(item: HTMLElement): void {
  const task: TaskData = JSON.parse(item.dataset.task || '{}')
  const restored = buildTaskItemDOM(task)
  restored.classList.add('selected')
  item.replaceWith(restored)
  editingItem = null
  notifyHeight()
}

function exitEditMode(item: HTMLElement): void {
  item.classList.remove('editing')
  editingItem = null
}

async function handleEnterOnSelected(): Promise<void> {
  const items = getTaskItems()
  if (selectedIndex < 0 || selectedIndex >= items.length) return
  const item = items[selectedIndex]
  const taskId = item.dataset.taskId!
  if (item.classList.contains('completed-undo')) {
    await undoComplete(taskId, item)
  } else if (!item.classList.contains('task-done')) {
    await completeTask(taskId, item, item.querySelector('.task-checkbox') as HTMLInputElement | null)
  }
}

async function loadConfig(): Promise<void> {
  const cfg = await window.quickViewApi.getConfig()
  if (cfg) isStandaloneMode = cfg.standalone_mode === true
}

async function loadTasks(forceRefresh = false): Promise<void> {
  const now = Date.now()
  const cacheValid = !forceRefresh && lastFetchResult && (now - lastFetchTime < CACHE_TTL_MS)
  if (cacheValid) { await applyFetchResult(lastFetchResult!); return }

  taskList.innerHTML = '<div class="loading">Loading tasks...</div>'
  hideStatusBar()

  const result = await window.quickViewApi.fetchTasks()
  // A cached list served because the refresh failed is not remembered as fresh, so
  // the next show tries the server again.
  if (result.success && !result.error) {
    lastFetchResult = result
    lastFetchTime = Date.now()
  }
  await applyFetchResult(result)
}

async function applyFetchResult(result: FetchResult): Promise<void> {
  if (result.success) {
    renderTasks(result.tasks || [])
    if (result.cached && result.error) {
      // The refresh failed for a reason other than being offline: show the cached list
      // but say why it may be out of date.
      showStatusBar(`Could not refresh (cached ${formatRelativeTime(result.cachedAt)})`, 'offline')
      showError(result.error)
    } else if (result.cached) {
      showStatusBar(`Offline \u2014 cached ${formatRelativeTime(result.cachedAt)}`, 'offline')
    } else if (result.standalone) {
      showStatusBar('Standalone mode', 'standalone')
    } else {
      const { pending, failed } = await window.quickViewApi.getQueueCounts()
      if (failed > 0) {
        const waiting = pending > 0 ? `${pending} action(s) pending sync, ` : ''
        showStatusBar(`${waiting}${failed} failed \u2014 open Vicu to review`, 'failed')
      } else if (pending > 0) {
        showStatusBar(`${pending} action(s) pending sync`, 'pending')
      }
    }
  } else {
    taskList.innerHTML = ''
    showError(result.error || 'Failed to load tasks')
  }
  notifyHeight()
}

// Event listeners
window.quickViewApi.onShowWindow(() => {
  isWindowVisible = true
  // Trigger entrance animation immediately — no awaits before this, so the
  // panel doesn't appear at full opacity then re-animate after the data load.
  container.classList.remove('visible')
  void container.offsetHeight
  container.classList.add('visible')

  // Refresh config and tasks in the background.
  void (async () => {
    await loadConfig()
    await loadTasks()
    requestAnimationFrame(() => notifyHeight())
  })()
})

// When the window is hidden, reset visibility so next show starts clean
window.quickViewApi.onHideWindow(() => {
  isWindowVisible = false
  container.classList.remove('visible')
})

window.quickViewApi.onSyncCompleted(async () => {
  if (!isWindowVisible) {
    // Don't fetch while hidden — just invalidate so the next show refetches.
    lastFetchTime = 0
    return
  }
  await loadTasks(true)
})

// When settings change in the main app, drop the cached fetch so the next
// show fetches fresh tasks with the updated viewer_filter.
window.quickViewApi.onConfigChanged(() => {
  lastFetchTime = 0
})

// Dates follow the system locale and the Settings clock choice. A change drops the cached list so
// the next show draws the due dates again with the new format.
void initDateFormat(window.quickViewApi)
subscribeDateFormat(() => {
  lastFetchTime = 0
})

window.quickViewApi.onDragHover((hovering: boolean) => {
  if (dragHandle) dragHandle.classList.toggle('hover', hovering)
})

// Keyboard handling
document.addEventListener('keydown', (e) => {
  if (editingItem) {
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(editingItem) }
    return
  }
  if (e.key === 'Escape') { e.preventDefault(); window.quickViewApi.closeWindow(); return }
  if (e.key === 'ArrowDown') { e.preventDefault(); updateSelection(selectedIndex + 1); return }
  if (e.key === 'ArrowUp') { e.preventDefault(); updateSelection(selectedIndex - 1); return }
  if (e.key === 'Tab') { e.preventDefault(); toggleSelectedDescription(); return }
  if (e.shiftKey && e.key === 'Enter') { e.preventDefault(); enterEditMode(); return }
  if (e.key === '!') { e.preventDefault(); toggleDueDate(); return }
  if (e.key === 'Enter') { e.preventDefault(); handleEnterOnSelected(); return }
})

document.addEventListener('mousedown', (e) => {
  if (!container.contains(e.target as Node)) window.quickViewApi.closeWindow()
})

taskList.addEventListener('click', (e) => {
  const item = (e.target as HTMLElement).closest('.task-item') as HTMLElement | null
  if (!item) return
  const items = getTaskItems()
  const index = Array.from(items).indexOf(item)
  if (index >= 0) updateSelection(index)
})

// Initial load
requestAnimationFrame(async () => {
  await loadConfig()
  container.classList.add('visible')
  loadTasks()
})

export {}
