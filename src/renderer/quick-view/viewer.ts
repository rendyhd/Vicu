declare global {
  interface Window {
    quickViewApi: {
      fetchTasks(): Promise<FetchResult>
      markTaskDone(taskId: number, taskData: Record<string, unknown>): Promise<ActionResult>
      markTaskUndone(taskId: number, taskData: Record<string, unknown>): Promise<ActionResult>
      scheduleTaskToday(taskId: number, taskData: Record<string, unknown>): Promise<ActionResult>
      removeDueDate(taskId: number, taskData: Record<string, unknown>): Promise<ActionResult>
      updateTask(taskId: number, taskData: Record<string, unknown>): Promise<ActionResult>
      openTaskInBrowser(taskId: number): Promise<void>
      closeWindow(): Promise<void>
      setHeight(height: number): Promise<void>
      getPendingCount(): Promise<number>
      getConfig(): Promise<QuickViewConfig | null>
      onShowWindow(callback: () => void): void
      onSyncCompleted(callback: () => void): void
      onDragHover(callback: (_event: unknown, hovering: boolean) => void): void
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

import { extractTaskLink } from '@/lib/note-link'

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
const CACHE_TTL_MS = 30000
const completedTasks = new Map<string, TaskData>()
const cachedCompletions = new Set<string>()

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

function formatDueDate(dueDateStr: string | null | undefined): { label: string; cssClass: string } | null {
  if (!dueDateStr || dueDateStr === '0001-01-01T00:00:00Z') return null

  const due = new Date(dueDateStr)
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  const tomorrowEnd = new Date(todayEnd.getTime() + 86400000)

  let label: string
  let cssClass: string

  if (due < todayStart) {
    const diffDays = Math.ceil((todayStart.getTime() - due.getTime()) / 86400000)
    label = diffDays === 1 ? 'Yesterday' : `${diffDays} days overdue`
    cssClass = 'overdue'
  } else if (due <= todayEnd) {
    label = 'Today'
    cssClass = 'today'
  } else if (due <= tomorrowEnd) {
    label = 'Tomorrow'
    cssClass = 'upcoming'
  } else {
    const diffDays = Math.ceil((due.getTime() - todayStart.getTime()) / 86400000)
    if (diffDays <= 7) {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      label = days[due.getDay()]
    } else {
      const month = due.toLocaleString('default', { month: 'short' })
      label = `${month} ${due.getDate()}`
      if (due.getFullYear() !== now.getFullYear()) label += `, ${due.getFullYear()}`
    }
    cssClass = 'upcoming'
  }

  return { label, cssClass }
}

function buildTaskItemDOM(task: TaskData): HTMLElement {
  const item = document.createElement('div')
  item.className = 'task-item'
  item.dataset.taskId = String(task.id)
  item.dataset.task = JSON.stringify(task)

  if (task.priority && task.priority > 0) {
    const priority = document.createElement('span')
    priority.className = `task-priority priority-${Math.min(task.priority, 5)}`
    item.appendChild(priority)
  }

  const checkbox = document.createElement('input') as HTMLInputElement
  checkbox.type = 'checkbox'
  checkbox.className = 'task-checkbox'
  checkbox.title = 'Mark as done'
  checkbox.addEventListener('change', () => completeTask(task.id, item, checkbox))
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
      window.quickViewApi.openTaskInBrowser(Number(task.id))
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
      window.quickViewApi.openDeepLink(taskLink.kind === 'note' ? taskLink.url : taskLink.url)
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
    desc.className = 'task-description hidden'
    desc.textContent = task.description
    desc.addEventListener('click', (e) => {
      e.stopPropagation()
      const items = getTaskItems()
      const index = Array.from(items).indexOf(item)
      if (index >= 0) updateSelection(index)
      enterEditMode(true)
    })
    content.appendChild(desc)
  }

  item.appendChild(content)
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
  if (checkbox) checkbox.disabled = true
  itemElement.classList.add('completing')

  const result = await window.quickViewApi.markTaskDone(Number(taskId), originalTask)

  if (result.success) {
    lastFetchResult = null
    completedTasks.set(String(taskId), originalTask)
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
  const result = await window.quickViewApi.markTaskUndone(Number(taskId), storedTask || {})

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
    const result = await window.quickViewApi.removeDueDate(Number(taskId), taskData)
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
    const result = await window.quickViewApi.scheduleTaskToday(Number(taskId), taskData)
    if (result.success) {
      lastFetchResult = null
      const now = new Date()
      taskData.due_date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()
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
  editingItem = item
  item.classList.add('editing')
  ;(item as any)._originalHTML = item.innerHTML

  item.innerHTML = ''
  const editWrapper = document.createElement('div')
  editWrapper.className = 'task-edit-wrapper'

  const titleInput = document.createElement('input') as HTMLInputElement
  titleInput.type = 'text'
  titleInput.className = 'task-edit-title'
  titleInput.value = taskData.title || ''
  titleInput.placeholder = 'Task title'

  const descTextarea = document.createElement('textarea') as HTMLTextAreaElement
  descTextarea.className = 'task-edit-description'
  descTextarea.value = taskData.description || ''
  descTextarea.placeholder = 'Description (optional)'
  descTextarea.rows = 3

  editWrapper.appendChild(titleInput)
  editWrapper.appendChild(descTextarea)

  const hint = document.createElement('div')
  hint.className = 'task-edit-hint'
  hint.textContent = 'Enter to save \u00b7 Shift+Enter for new line \u00b7 Esc to cancel'
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
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(item, titleInput.value, descTextarea.value) }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(item) }
    else if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); titleInput.focus() }
  })

  titleInput.addEventListener('keypress', (e) => e.stopPropagation())
  descTextarea.addEventListener('keypress', (e) => e.stopPropagation())

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
  const updatedData = { ...taskData, title: trimmedTitle, description: newDescription }

  const result = await window.quickViewApi.updateTask(Number(taskId), updatedData)

  if (result.success) {
    lastFetchResult = null
    taskData.title = trimmedTitle
    taskData.description = newDescription
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

function cancelEdit(item: HTMLElement): void {
  if ((item as any)._originalHTML) {
    item.innerHTML = (item as any)._originalHTML
    delete (item as any)._originalHTML
  }
  item.classList.remove('editing')
  editingItem = null
  notifyHeight()
}

function exitEditMode(item: HTMLElement): void {
  delete (item as any)._originalHTML
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
  } else {
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
  if (result.success) {
    lastFetchResult = result
    lastFetchTime = Date.now()
  }
  await applyFetchResult(result)
}

async function applyFetchResult(result: FetchResult): Promise<void> {
  if (result.success) {
    renderTasks(result.tasks || [])
    if (result.cached) {
      showStatusBar(`Offline \u2014 cached ${formatRelativeTime(result.cachedAt)}`, 'offline')
    } else if (result.standalone) {
      showStatusBar('Standalone mode', 'standalone')
    } else {
      const pendingCount = await window.quickViewApi.getPendingCount()
      if (pendingCount > 0) showStatusBar(`${pendingCount} action(s) pending sync`, 'pending')
    }
  } else {
    taskList.innerHTML = ''
    showError(result.error || 'Failed to load tasks')
  }
  notifyHeight()
}

// Event listeners
window.quickViewApi.onShowWindow(async () => {
  await loadConfig()
  await loadTasks()
  container.classList.remove('visible')
  void container.offsetHeight
  container.classList.add('visible')
  requestAnimationFrame(() => notifyHeight())
})

window.quickViewApi.onSyncCompleted(async () => {
  await loadTasks(true)
})

window.quickViewApi.onDragHover((_: unknown, hovering: boolean) => {
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
