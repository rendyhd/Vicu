declare global {
  interface Window {
    quickEntryApi: {
      platform: 'darwin' | 'win32' | 'linux'
      saveTask(title: string, description: string | null, dueDate: string | null, projectId: number | null, priority?: number, repeatAfter?: number, repeatMode?: number): Promise<{ success: boolean; cached?: boolean; error?: string; data?: { id: number } }>
      closeWindow(): Promise<void>
      getConfig(): Promise<QuickEntryConfig | null>
      getPendingCount(): Promise<number>
      fetchLabels(): Promise<{ success: boolean; data?: Array<{ id: number; title: string }> }>
      fetchProjects(): Promise<{ success: boolean; data?: Array<{ id: number; title: string }> }>
      addLabelToTask(taskId: number, labelId: number): Promise<{ success: boolean }>
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
  nlp_enabled: boolean
  nlp_syntax_mode: 'todoist' | 'vikunja'
}

import { parse, getParserConfig, recurrenceToVikunja } from '../lib/task-parser'
import type { ParseResult, ParserConfig, ParsedToken } from '../lib/task-parser'

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
const inputHighlight = document.getElementById('input-highlight')!
const parsePreview = document.getElementById('parse-preview')!

let errorTimeout: ReturnType<typeof setTimeout> | null = null
let exclamationTodayEnabled = true
let projectCycle: Array<{ id: number; title: string | null }> = []
let currentProjectIndex = 0
let projectCycleModifier = 'ctrl'
let obsidianContext: { deepLink: string; noteName: string; isUidBased: boolean } | null = null
let obsidianLinked = false
let browserContext: { url: string; title: string; displayTitle: string } | null = null
let browserLinked = false
let parserConfig: ParserConfig = { enabled: true, syntaxMode: 'todoist' }
let cachedLabels: Array<{ id: number; title: string }> = []
let cachedProjects: Array<{ id: number; title: string }> = []
let lastParseResult: ParseResult | null = null
let isComposing = false

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
  // When parser is enabled, it handles ! via date/priority parsing — suppress legacy hints
  if (parserConfig.enabled) {
    todayHintInline.classList.add('hidden')
    todayHintBelow.classList.add('hidden')
    return
  }

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
  clearNlpState()
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

// --- NLP Parser Helpers ---

function refreshLabelsAndProjects(): void {
  // Fire-and-forget — runs in background while window is already visible
  Promise.all([
    window.quickEntryApi.fetchLabels(),
    window.quickEntryApi.fetchProjects(),
  ]).then(([labelsResult, projectsResult]) => {
    if (labelsResult.success && labelsResult.data) cachedLabels = labelsResult.data
    if (projectsResult.success && projectsResult.data) cachedProjects = projectsResult.data
  }).catch(() => {
    // Offline or standalone — keep existing cache
  })
}

function renderHighlights(inputValue: string, tokens: ParsedToken[]): void {
  if (!tokens.length) {
    inputHighlight.innerHTML = ''
    return
  }
  const sorted = [...tokens].sort((a, b) => a.start - b.start)
  let html = ''
  let pos = 0
  for (const token of sorted) {
    if (token.start > pos) {
      html += escapeHighlightText(inputValue.slice(pos, token.start))
    }
    html += `<span class="token-${token.type}">${escapeHighlightText(inputValue.slice(token.start, token.end))}</span>`
    pos = token.end
  }
  if (pos < inputValue.length) {
    html += escapeHighlightText(inputValue.slice(pos))
  }
  inputHighlight.innerHTML = html
}

function escapeHighlightText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/ /g, '\u00a0')
}

function renderParsePreview(result: ParseResult): void {
  const chips: string[] = []

  if (result.dueDate) {
    const label = formatDateLabel(result.dueDate)
    chips.push(`<span class="parse-chip parse-chip-date">${escapeHtml(label)}</span>`)
  }
  if (result.priority !== null && result.priority > 0) {
    const labels = ['', 'Low', 'Medium', 'High', 'Urgent']
    const label = labels[result.priority] || `P${result.priority}`
    chips.push(`<span class="parse-chip parse-chip-priority">${escapeHtml(label)}</span>`)
  }
  for (const lbl of result.labels) {
    chips.push(`<span class="parse-chip parse-chip-label">${escapeHtml(lbl)}</span>`)
  }
  if (result.project) {
    chips.push(`<span class="parse-chip parse-chip-project">${escapeHtml(result.project)}</span>`)
  }
  if (result.recurrence) {
    const unit = result.recurrence.unit
    const interval = result.recurrence.interval
    const label = interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`
    chips.push(`<span class="parse-chip parse-chip-recurrence">${escapeHtml(label)}</span>`)
  }

  if (chips.length > 0) {
    parsePreview.innerHTML = chips.join('')
    parsePreview.classList.remove('hidden')
  } else {
    parsePreview.innerHTML = ''
    parsePreview.classList.add('hidden')
  }
}

function formatDateLabel(date: Date): string {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays === -1) return 'Yesterday'
  if (diffDays > 1 && diffDays <= 7) {
    return target.toLocaleDateString(undefined, { weekday: 'long' })
  }
  return target.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function clearNlpState(): void {
  inputHighlight.innerHTML = ''
  parsePreview.innerHTML = ''
  parsePreview.classList.add('hidden')
  lastParseResult = null
}

async function saveTask(): Promise<void> {
  const raw = input.value.trim()
  if (!raw) return

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

  let title = raw
  let dueDate: string | null = null
  let priority: number | undefined
  let repeatAfter: number | undefined
  let repeatMode: number | undefined
  let projectId = projectCycle.length > 0 ? projectCycle[currentProjectIndex].id : null
  let parsedLabels: string[] = []

  if (parserConfig.enabled && lastParseResult) {
    title = lastParseResult.title
    if (!title) return

    if (lastParseResult.dueDate) {
      const d = lastParseResult.dueDate
      d.setHours(23, 59, 59, 0)
      dueDate = d.toISOString()
    }

    if (lastParseResult.priority !== null && lastParseResult.priority > 0) {
      priority = lastParseResult.priority
    }

    if (lastParseResult.recurrence) {
      const vik = recurrenceToVikunja(lastParseResult.recurrence)
      repeatAfter = vik.repeat_after
      repeatMode = vik.repeat_mode
    }

    // Resolve project name to ID
    if (lastParseResult.project) {
      const projName = lastParseResult.project.toLowerCase()
      const match = cachedProjects.find((p) => p.title.toLowerCase() === projName)
      if (match) projectId = match.id
    }

    parsedLabels = lastParseResult.labels
  } else {
    // Legacy ! → today behavior
    if (exclamationTodayEnabled && title.includes('!')) {
      title = title.replace(/!/g, '').trim()
      if (!title) return
      const today = new Date()
      today.setHours(23, 59, 59, 0)
      dueDate = today.toISOString()
    }
  }

  input.disabled = true
  descriptionInput.disabled = true
  clearError()

  const result = await window.quickEntryApi.saveTask(title, description || null, dueDate, projectId, priority, repeatAfter, repeatMode)

  if (result.success) {
    // Attach labels post-creation
    if (parsedLabels.length > 0 && result.data?.id) {
      const taskId = result.data.id
      for (const labelName of parsedLabels) {
        const match = cachedLabels.find((l) => l.title.toLowerCase() === labelName.toLowerCase())
        if (match) {
          try {
            await window.quickEntryApi.addLabelToTask(taskId, match.id)
          } catch {
            // Skip silently
          }
        }
      }
    }

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
    parserConfig = getParserConfig({ nlp_enabled: cfg.nlp_enabled, nlp_syntax_mode: cfg.nlp_syntax_mode })
  }

  refreshLabelsAndProjects()

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

// IME composition guard
input.addEventListener('compositionstart', () => { isComposing = true })
input.addEventListener('compositionend', () => {
  isComposing = false
  handleInputChange()
})

// Scroll sync for highlight overlay
input.addEventListener('scroll', () => {
  inputHighlight.scrollLeft = input.scrollLeft
})

function handleInputChange(): void {
  updateTodayHints()


  const raw = input.value
  if (!parserConfig.enabled || !raw) {
    clearNlpState()
    return
  }

  const result = parse(raw, parserConfig)
  lastParseResult = result
  renderHighlights(raw, result.tokens)
  renderParsePreview(result)

  // Hide legacy today hints when parser is active and found a date
  if (result.dueDate) {
    todayHintInline.classList.add('hidden')
    todayHintBelow.classList.add('hidden')
  }
}

// Detect input changes and run parser
input.addEventListener('input', () => {
  if (isComposing) return
  handleInputChange()
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
    parserConfig = getParserConfig({ nlp_enabled: cfg.nlp_enabled, nlp_syntax_mode: cfg.nlp_syntax_mode })
  }
  refreshLabelsAndProjects()

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
