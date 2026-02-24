declare global {
  interface Window {
    quickEntryApi: {
      platform: 'darwin' | 'win32' | 'linux'
      saveTask(title: string, description: string | null, dueDate: string | null, projectId: number | null): Promise<{ success: boolean; cached?: boolean; error?: string }>
      closeWindow(): Promise<void>
      getConfig(): Promise<QuickEntryConfig | null>
      getPendingCount(): Promise<number>
      onShowWindow(callback: () => void): void
      onHideWindow(callback: () => void): void
      onSyncCompleted(callback: () => void): void
      onDragHover(callback: (_event: unknown, hovering: boolean) => void): void
      onObsidianContext(callback: (context: {
        deepLink: string; noteName: string; vaultName: string; isUidBased: boolean; mode: 'ask' | 'always'
      } | null) => void): void
      onBrowserContext(callback: (context: {
        url: string; title: string; displayTitle: string; mode: 'ask' | 'always'
      } | null) => void): void
    }
  }
}

interface QuickEntryConfig {
  vikunja_url: string
  quick_entry_default_project_id: number
  inbox_project_id: number
  exclamation_today: boolean
  secondary_projects: Array<{ id: number; title: string }>
  project_cycle_modifier: string
  standalone_mode: boolean
}

const input = document.getElementById('task-input') as HTMLInputElement
const descriptionHint = document.getElementById('description-hint')!
const descriptionInput = document.getElementById('description-input') as HTMLTextAreaElement
const container = document.getElementById('container')!
const errorMessage = document.getElementById('error-message')!
const todayHintInline = document.getElementById('today-hint-inline')!
const todayHintBelow = document.getElementById('today-hint-below')!
const projectHint = document.getElementById('project-hint')!
const projectName = document.getElementById('project-name')!
const pendingIndicator = document.getElementById('pending-indicator')!
const pendingCountEl = document.getElementById('pending-count')!
const dragHandle = document.querySelector('.drag-handle')!
const obsidianHint = document.getElementById('obsidian-hint')!
const obsidianHintName = document.getElementById('obsidian-hint-name')!
const obsidianBadge = document.getElementById('obsidian-badge')!
const obsidianBadgeName = document.getElementById('obsidian-badge-name')!
const obsidianBadgeRemove = document.getElementById('obsidian-badge-remove')!
const browserHint = document.getElementById('browser-hint')!
const browserHintName = document.getElementById('browser-hint-name')!
const browserBadge = document.getElementById('browser-badge')!
const browserBadgeName = document.getElementById('browser-badge-name')!
const browserBadgeRemove = document.getElementById('browser-badge-remove')!

let errorTimeout: ReturnType<typeof setTimeout> | null = null
let exclamationTodayEnabled = true
let projectCycle: Array<{ id: number; title: string | null }> = []
let currentProjectIndex = 0
let projectCycleModifier = 'ctrl'
let obsidianContext: { deepLink: string; noteName: string; isUidBased: boolean } | null = null
let obsidianLinked = false
let browserContext: { url: string; title: string; displayTitle: string } | null = null
let browserLinked = false

// Set platform-aware hint key text
const isMac = window.quickEntryApi.platform === 'darwin'
const linkKeyLabel = isMac ? '\u2318L' : 'Ctrl+L'
document.querySelectorAll('.obsidian-hint-key, .browser-hint-key').forEach((el) => {
  el.textContent = linkKeyLabel
})

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

function showOfflineMessage(): void {
  errorMessage.textContent = 'Saved offline \u2014 will sync when connected'
  errorMessage.hidden = false
  errorMessage.classList.add('offline')
  void errorMessage.offsetHeight
  errorMessage.classList.add('show')

  if (errorTimeout) clearTimeout(errorTimeout)
  errorTimeout = setTimeout(() => {
    errorMessage.classList.remove('show')
    setTimeout(() => {
      errorMessage.hidden = true
      errorMessage.classList.remove('offline')
      window.quickEntryApi.closeWindow()
    }, 200)
  }, 1200)
}

function clearError(): void {
  if (errorTimeout) clearTimeout(errorTimeout)
  errorMessage.classList.remove('show', 'offline')
  errorMessage.hidden = true
}

function collapseDescription(): void {
  descriptionInput.classList.add('hidden')
  descriptionInput.value = ''
  descriptionHint.classList.remove('hidden')
  updateTodayHints()
}

function expandDescription(): void {
  descriptionHint.classList.add('hidden')
  descriptionInput.classList.remove('hidden')
  descriptionInput.focus()
  updateTodayHints()
}

function isDescriptionExpanded(): boolean {
  return !descriptionInput.classList.contains('hidden')
}

function updateTodayHints(): void {
  const hasExclamation = exclamationTodayEnabled && input.value.includes('!')

  if (hasExclamation && !isDescriptionExpanded()) {
    todayHintInline.classList.remove('hidden')
    todayHintBelow.classList.add('hidden')
  } else if (hasExclamation && isDescriptionExpanded()) {
    todayHintInline.classList.add('hidden')
    todayHintBelow.classList.remove('hidden')
  } else {
    todayHintInline.classList.add('hidden')
    todayHintBelow.classList.add('hidden')
  }
}

async function updatePendingIndicator(): Promise<void> {
  const count = await window.quickEntryApi.getPendingCount()
  if (count > 0) {
    pendingCountEl.textContent = String(count)
    pendingIndicator.classList.remove('hidden')
  } else {
    pendingIndicator.classList.add('hidden')
  }
}

function resetInput(): void {
  input.value = ''
  input.disabled = false
  descriptionInput.disabled = false
  collapseDescription()
  clearError()
  todayHintInline.classList.add('hidden')
  todayHintBelow.classList.add('hidden')
  currentProjectIndex = 0
  updateProjectHint()
  input.focus()
}

function buildProjectCycle(cfg: QuickEntryConfig): void {
  const defaultId = cfg.quick_entry_default_project_id || cfg.inbox_project_id
  projectCycle = [{ id: defaultId, title: null }]
  if (cfg.secondary_projects && cfg.secondary_projects.length > 0) {
    for (const p of cfg.secondary_projects) {
      projectCycle.push({ id: p.id, title: p.title })
    }
  }
  currentProjectIndex = 0
  updateProjectHint()
}

function updateProjectHint(): void {
  if (currentProjectIndex === 0 || projectCycle.length <= 1) {
    projectHint.classList.add('hidden')
  } else {
    projectName.textContent = projectCycle[currentProjectIndex].title || ''
    projectHint.classList.remove('hidden')
  }
}

function cycleProject(direction: number): void {
  if (projectCycle.length <= 1) return
  currentProjectIndex += direction
  if (currentProjectIndex >= projectCycle.length) currentProjectIndex = 0
  if (currentProjectIndex < 0) currentProjectIndex = projectCycle.length - 1
  updateProjectHint()
}

function updateObsidianUI(): void {
  if (!obsidianContext) {
    obsidianHint.classList.add('hidden')
    obsidianBadge.classList.add('hidden')
    return
  }
  if (obsidianLinked) {
    obsidianBadgeName.textContent = obsidianContext.noteName
    obsidianBadge.classList.remove('hidden')
    obsidianHint.classList.add('hidden')
  } else {
    obsidianHintName.textContent = `"${obsidianContext.noteName}"`
    obsidianHint.classList.remove('hidden')
    obsidianBadge.classList.add('hidden')
  }
}

function updateBrowserUI(): void {
  if (!browserContext) {
    browserHint.classList.add('hidden')
    browserBadge.classList.add('hidden')
    return
  }
  if (browserLinked) {
    browserBadgeName.textContent = browserContext.displayTitle
    browserBadge.classList.remove('hidden')
    browserHint.classList.add('hidden')
  } else {
    browserHintName.textContent = `"${browserContext.displayTitle}"`
    browserHint.classList.remove('hidden')
    browserBadge.classList.add('hidden')
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildNoteLinkHtml(deepLink: string, noteName: string): string {
  const safeLink = escapeHtml(deepLink)
  const safeName = escapeHtml(noteName)
  return `<!-- notelink:${safeLink} --><p><a href="${safeLink}">\u{1F4CE} ${safeName}</a></p>`
}

function buildPageLinkHtml(url: string, title: string): string {
  const safeUrl = escapeHtml(url)
  const safeTitle = escapeHtml(title)
  return `<!-- pagelink:${safeUrl} --><p><a href="${safeUrl}">\u{1F517} ${safeTitle}</a></p>`
}

function isProjectCycleModifierPressed(e: KeyboardEvent): boolean {
  const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey
  switch (projectCycleModifier) {
    case 'alt':
      return e.altKey && !cmdOrCtrl
    case 'ctrl+alt':
      return cmdOrCtrl && e.altKey
    case 'ctrl':
    default:
      return cmdOrCtrl && !e.altKey
  }
}

async function saveTask(): Promise<void> {
  let title = input.value.trim()
  if (!title) return

  let description: string | null = descriptionInput.value.trim() || null

  // Inject Obsidian note link into description
  if (obsidianLinked && obsidianContext) {
    const linkHtml = buildNoteLinkHtml(obsidianContext.deepLink, obsidianContext.noteName)
    description = description ? `<p>${escapeHtml(description)}</p>${linkHtml}` : linkHtml
  }

  // Inject browser page link into description
  if (!obsidianLinked && browserLinked && browserContext) {
    const linkHtml = buildPageLinkHtml(browserContext.url, browserContext.title)
    description = description ? `<p>${escapeHtml(description)}</p>${linkHtml}` : linkHtml
  }

  let dueDate: string | null = null
  if (exclamationTodayEnabled && title.includes('!')) {
    title = title.replace(/!/g, '').trim()
    if (!title) return
    const today = new Date()
    today.setHours(23, 59, 59, 0)
    dueDate = today.toISOString()
  }

  input.disabled = true
  descriptionInput.disabled = true
  clearError()

  const projectId = projectCycle.length > 0 ? projectCycle[currentProjectIndex].id : null
  const result = await window.quickEntryApi.saveTask(title, description || null, dueDate, projectId)

  if (result.success) {
    if (result.cached) {
      showOfflineMessage()
    } else {
      window.quickEntryApi.closeWindow()
    }
  } else {
    showError(result.error || 'Failed to save task')
    input.disabled = false
    descriptionInput.disabled = false
    input.focus()
  }
}

// When the window is hidden, reset state immediately so next show starts clean
window.quickEntryApi.onHideWindow(() => {
  container.classList.remove('visible')
  resetInput()
  obsidianContext = null
  obsidianLinked = false
  updateObsidianUI()
  browserContext = null
  browserLinked = false
  updateBrowserUI()
})

// When the main process signals the window is shown
window.quickEntryApi.onShowWindow(async () => {
  resetInput()

  const cfg = await window.quickEntryApi.getConfig()
  if (cfg) {
    exclamationTodayEnabled = cfg.exclamation_today !== false
    projectCycleModifier = cfg.project_cycle_modifier || 'ctrl'
    buildProjectCycle(cfg)
  }

  await updatePendingIndicator()
  input.focus()

  container.classList.remove('visible')
  void container.offsetHeight
  container.classList.add('visible')
})

// When background sync completes, update the pending count
window.quickEntryApi.onSyncCompleted(async () => {
  await updatePendingIndicator()
})

window.quickEntryApi.onDragHover((_: unknown, hovering: boolean) => {
  if (dragHandle) dragHandle.classList.toggle('hover', hovering)
})

// Keyboard handling on title input
input.addEventListener('keydown', async (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
    e.preventDefault()
    if (obsidianContext) {
      obsidianLinked = !obsidianLinked
      updateObsidianUI()
    } else if (browserContext) {
      browserLinked = !browserLinked
      updateBrowserUI()
    }
    return
  }
  if (isProjectCycleModifierPressed(e) && e.key === 'ArrowRight') {
    e.preventDefault()
    cycleProject(1)
    return
  }
  if (isProjectCycleModifierPressed(e) && e.key === 'ArrowLeft') {
    e.preventDefault()
    cycleProject(-1)
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    window.quickEntryApi.closeWindow()
    return
  }
  if (e.key === 'Tab') {
    e.preventDefault()
    expandDescription()
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    await saveTask()
  }
})

// Keyboard handling on description textarea
descriptionInput.addEventListener('keydown', async (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
    e.preventDefault()
    if (obsidianContext) {
      obsidianLinked = !obsidianLinked
      updateObsidianUI()
    } else if (browserContext) {
      browserLinked = !browserLinked
      updateBrowserUI()
    }
    return
  }
  if (isProjectCycleModifierPressed(e) && e.key === 'ArrowRight') {
    e.preventDefault()
    cycleProject(1)
    return
  }
  if (isProjectCycleModifierPressed(e) && e.key === 'ArrowLeft') {
    e.preventDefault()
    cycleProject(-1)
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    window.quickEntryApi.closeWindow()
    return
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    await saveTask()
  }
})

// Detect ! in task title to show today scheduling hint
input.addEventListener('input', () => {
  updateTodayHints()
})

// Obsidian badge remove button
obsidianBadgeRemove.addEventListener('click', () => {
  obsidianLinked = false
  updateObsidianUI()
})

browserBadgeRemove.addEventListener('click', () => {
  browserLinked = false
  updateBrowserUI()
})

// Obsidian context listener
window.quickEntryApi.onObsidianContext((ctx) => {
  if (!ctx) {
    obsidianContext = null
    obsidianLinked = false
    updateObsidianUI()
    return
  }
  obsidianContext = { deepLink: ctx.deepLink, noteName: ctx.noteName, isUidBased: ctx.isUidBased }
  obsidianLinked = ctx.mode === 'always'
  updateObsidianUI()
})

// Browser context listener
window.quickEntryApi.onBrowserContext((ctx) => {
  if (!ctx) {
    browserContext = null
    browserLinked = false
    updateBrowserUI()
    return
  }
  browserContext = { url: ctx.url, title: ctx.title, displayTitle: ctx.displayTitle }
  browserLinked = ctx.mode === 'always'
  updateBrowserUI()
})

// Load config on startup
async function loadInitialConfig(): Promise<void> {
  const cfg = await window.quickEntryApi.getConfig()
  if (cfg) {
    exclamationTodayEnabled = cfg.exclamation_today !== false
    projectCycleModifier = cfg.project_cycle_modifier || 'ctrl'
    buildProjectCycle(cfg)
  }
  await updatePendingIndicator()
}
loadInitialConfig()

// Close window when clicking outside the container (transparent area)
document.addEventListener('mousedown', (e) => {
  if (!container.contains(e.target as Node)) {
    window.quickEntryApi.closeWindow()
  }
})

// Initial animation on first load
requestAnimationFrame(() => {
  container.classList.add('visible')
  input.focus()
})

export {}
