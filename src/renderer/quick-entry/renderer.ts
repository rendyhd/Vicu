declare global {
  interface Window {
    quickEntryApi: {
      platform: 'darwin' | 'win32' | 'linux'
      saveTask(
        title: string,
        description: string | null,
        dueDate: string | null,
        projectId: number | null,
        priority?: number,
        repeatAfter?: number,
        repeatMode?: number,
        // Kept with the create when it has to be queued offline; unused when the server answers.
        extras?: { labels?: Array<{ id?: number; title?: string }>; images?: Array<{ name: string; mime: string; bytes: Uint8Array }> },
      ): Promise<{ success: boolean; cached?: boolean; error?: string; mayExist?: boolean; data?: { id: number } }>
      uploadAttachment(taskId: number, fileData: Uint8Array, fileName: string, mimeType: string): Promise<{ success: boolean; error?: string; statusCode?: number }>
      fetchTaskAttachments(taskId: number): Promise<{ success: boolean; data?: Array<{ id: number }>; error?: string; statusCode?: number }>
      updateTask(taskId: number, task: Record<string, unknown>): Promise<{ success: boolean; error?: string; statusCode?: number; data?: unknown }>
      closeWindow(): Promise<void>
      // The locale and clock dates are phrased with (system locale, Settings clock choice).
      getDateFormat(): Promise<{ locale: string; hour12: boolean }>
      onDateFormatChanged(callback: (format: { locale: string; hour12: boolean }) => void): void
      // The note's final link when saving with it linked; the uid is written into the note then.
      resolveObsidianLink(): Promise<{ deepLink: string; noteName: string; isUidBased: boolean } | null>
      setHeight(height: number): Promise<void>
      getConfig(): Promise<QuickEntryConfig | null>
      getPendingCount(): Promise<number>
      getQueueCounts(): Promise<{ pending: number; failed: number }>
      // Queue what failed after an online create (labels by id or title, images with their bytes).
      queueFollowUps(
        taskId: number,
        extras: { labels: Array<{ id?: number; title?: string }>; images: Array<{ name: string; mime: string; bytes: Uint8Array }> },
        title?: string,
      ): Promise<{ success: boolean; error?: string }>
      fetchLabels(): Promise<{ success: boolean; data?: Array<{ id: number; title: string }> }>
      fetchProjects(): Promise<{ success: boolean; data?: Array<{ id: number; title: string }> }>
      addLabelToTask(taskId: number, labelId: number): Promise<{ success: boolean; error?: string; statusCode?: number }>
      createLabel(label: { title: string; hex_color?: string }): Promise<{ success: boolean; error?: string; statusCode?: number; data?: { id: number; title: string } }>
      onShowWindow(callback: () => void): void
      onHideWindow(callback: () => void): void
      onSyncCompleted(callback: () => void): void
      onDragHover(callback: (hovering: boolean) => void): void
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

import { parse, getParserConfig, recurrenceToVikunja, extractBangToday } from '../lib/task-parser'
import { dueToday, parsedDue } from '../lib/due-dates'
import { followColorScheme } from '../lib/theme'
import { parseChips } from '../lib/parse-chips'
import { motionMs, motionSpringCurve, travelStart } from '../lib/motion'
import { initDateFormat, subscribeDateFormat } from '../lib/date-format'
import type { ParseResult, ParserConfig, ParsedToken, TokenType } from '../lib/task-parser'
import { getClipboardImages, fileToUint8Array } from '../lib/clipboard-images'
import { AutocompleteDropdown } from './autocomplete'
import { cache } from './vikunja-cache'
import { applyQuickEntryFollowUps } from '../lib/quick-entry-follow-ups'
import { escapeHtml, plainTextToDescriptionHtml } from '../lib/description-html'

followColorScheme()

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
const imageGallery = document.getElementById('image-gallery')!

let errorTimeout: ReturnType<typeof setTimeout> | null = null
let exclamationTodayEnabled = true
let projectCycle: Array<{ id: number; title: string | null }> = []
let currentProjectIndex = 0
let projectCycleModifier = 'ctrl'
let obsidianContext: { deepLink: string; noteName: string; isUidBased: boolean } | null = null
let obsidianLinked = false
let resolvingObsidianLink = false
let browserContext: { url: string; title: string; displayTitle: string } | null = null
let browserLinked = false
let parserConfig: ParserConfig = { enabled: true, syntaxMode: 'todoist' }
let cachedLabels: Array<{ id: number; title: string }> = []
let cachedProjects: Array<{ id: number; title: string }> = []
let lastParseResult: ParseResult | null = null
let isComposing = false
let suppressedTypes: Map<TokenType, string[]> = new Map()
let lastConfig: QuickEntryConfig | null = null

interface PendingImage {
  uuid: string
  blobUrl: string
  bytes: Uint8Array
  name: string
  mime: string
}
let pendingImages: PendingImage[] = []

// --- Autocomplete ---
const autocomplete = new AutocompleteDropdown('autocomplete-container', (item, triggerStart, prefix) => {
  const val = input.value
  // Find the end of the current token (next space or end of string)
  let tokenEnd = val.indexOf(' ', triggerStart)
  if (tokenEnd === -1) tokenEnd = val.length

  const hasSpaces = item.title.includes(' ')
  const replacement = hasSpaces ? `${prefix}"${item.title}" ` : `${prefix}${item.title} `

  input.value = val.substring(0, triggerStart) + replacement + val.substring(tokenEnd)
  const newCursorPos = triggerStart + replacement.length
  input.setSelectionRange(newCursorPos, newCursorPos)
  input.dispatchEvent(new Event('input'))
  input.focus()
})

// Set platform-aware hint key text
const isMac = window.quickEntryApi.platform === 'darwin'
const linkKeyLabel = isMac ? '\u2318L' : 'Ctrl+L'
document.querySelectorAll('.obsidian-hint-key, .browser-hint-key').forEach((el) => {
  el.textContent = linkKeyLabel
})

function showError(msg: string, visibleMs = 3000): void {
  errorMessage.textContent = msg
  errorMessage.hidden = false
  void errorMessage.offsetHeight
  errorMessage.classList.add('show')

  if (errorTimeout) clearTimeout(errorTimeout)
  errorTimeout = setTimeout(() => {
    errorMessage.classList.remove('show')
    setTimeout(() => { errorMessage.hidden = true }, 200)
  }, visibleMs)
}

function showOfflineMessage(message = 'Saved offline \u2014 will sync when connected'): void {
  errorMessage.textContent = message
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
  autoresizeDescription()
  updateTodayHints()
}

const MAX_DESCRIPTION_HEIGHT_PX = 200

function autoresizeDescription(): void {
  if (descriptionInput.classList.contains('hidden')) return
  descriptionInput.style.height = 'auto'
  const next = Math.min(descriptionInput.scrollHeight, MAX_DESCRIPTION_HEIGHT_PX)
  descriptionInput.style.height = `${next}px`
  descriptionInput.style.overflowY = descriptionInput.scrollHeight > MAX_DESCRIPTION_HEIGHT_PX ? 'auto' : 'hidden'
}

descriptionInput.addEventListener('input', autoresizeDescription)

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

  // Same rule as the save path: a `!` inside the text is not a date.
  const hasExclamation = exclamationTodayEnabled && !!extractBangToday(input.value).dueDate

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
  const { pending, failed } = await window.quickEntryApi.getQueueCounts()
  if (pending > 0 || failed > 0) {
    const parts: string[] = []
    if (pending > 0) parts.push(`${pending} change(s) pending sync`)
    if (failed > 0) parts.push(`${failed} failed \u2014 open Vicu to review`)
    pendingCountEl.textContent = parts.join(' \u00b7 ')
    pendingIndicator.classList.toggle('has-failed', failed > 0)
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
  clearPendingImages()
  autocomplete.hide()
  todayHintInline.classList.add('hidden')
  todayHintBelow.classList.add('hidden')
  currentProjectIndex = 0
  updateProjectHint()
  input.focus()
}

function buildProjectCycle(cfg: QuickEntryConfig): void {
  const activeIds = new Set(cachedProjects.map((project) => project.id))
  const configuredDefault = cfg.quick_entry_default_project_id || cfg.inbox_project_id
  const defaultId = activeIds.size === 0 || activeIds.has(configuredDefault)
    ? configuredDefault
    : activeIds.has(cfg.inbox_project_id)
      ? cfg.inbox_project_id
      : cachedProjects[0]?.id ?? 0
  projectCycle = [{ id: defaultId, title: null }]
  if (cfg.secondary_projects && cfg.secondary_projects.length > 0) {
    for (const p of cfg.secondary_projects) {
      if (activeIds.size > 0 && !activeIds.has(p.id)) continue
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
    if (labelsResult.success && labelsResult.data) {
      cachedLabels = labelsResult.data
      cache.setLabels(labelsResult.data)
    }
    if (projectsResult.success && projectsResult.data) {
      cachedProjects = projectsResult.data
      cache.setProjects(projectsResult.data)
      if (lastConfig) buildProjectCycle(lastConfig)
    }
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
    html += `<span class="token-${token.type}" data-token-type="${token.type}">${escapeHighlightText(inputValue.slice(token.start, token.end))}</span>`
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

/** Keys of the chips on screen: a chip travels out of its token only the first time it appears. */
let shownChipKeys = new Set<string>()

/**
 * A chip read from the typed text travels out of the highlighted token it came from, like the main
 * window's composer (card 4.11a, lib/motion.ts travelStart). Under reduced motion it fades in.
 */
function animateChipIn(chip: HTMLElement, type: string): void {
  if (typeof chip.animate !== 'function') return
  const fade = (): void => {
    chip.animate([{ opacity: 0 }, { opacity: 1 }], { duration: motionMs('fade-fast'), easing: 'linear' })
  }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    fade()
    return
  }
  const token = inputHighlight.querySelector<HTMLElement>(`[data-token-type="${type}"]`)
  if (!token) {
    fade()
    return
  }
  const from = travelStart(token.getBoundingClientRect(), chip.getBoundingClientRect())
  chip.animate(
    [
      { transform: `translate(${from.dx}px, ${from.dy}px) scale(${from.scale})`, opacity: 0.4 },
      { transform: 'none', opacity: 1 },
    ],
    { duration: motionMs('move'), easing: motionSpringCurve('move') },
  )
}

function renderParsePreview(result: ParseResult): void {
  // The same chips, in the same words, as the main window's composer (lib/parse-chips.ts).
  const chips = parseChips(result)

  if (chips.length === 0) {
    parsePreview.innerHTML = ''
    parsePreview.classList.add('hidden')
    shownChipKeys = new Set()
    return
  }

  // Chips that are unchanged keep their element (a travel in progress is not cut by the next key);
  // changed ones are rebuilt; new ones are animated in once the container is visible.
  const existing = new Map<string, HTMLElement>()
  for (const el of parsePreview.querySelectorAll<HTMLElement>('.parse-chip')) existing.set(el.dataset.chipKey ?? '', el)
  const entering: Array<{ el: HTMLElement; type: string }> = []
  const next: HTMLElement[] = []
  const nextKeys = new Set<string>()
  for (const chip of chips) {
    const level = chip.type === 'priority' ? ` priority-${Math.min(Math.max(chip.priority ?? 1, 1), 5)}` : ''
    const source = chip.source ?? 'text'
    const signature = `${chip.label}|${chip.priority ?? ''}|${source}`
    const html = `<span class="parse-chip parse-chip-${chip.type}${level}" data-chip-key="${escapeHtml(chip.key)}" data-chip-sig="${escapeHtml(signature)}" data-chip-type="${chip.type}" data-chip-source="${source}">${escapeHtml(chip.label)}<button class="parse-chip-dismiss" data-type="${chip.type}" aria-label="Dismiss ${chip.type}">&times;</button></span>`
    const kept = existing.get(chip.key)
    if (kept && kept.dataset.chipSig === signature) {
      next.push(kept)
    } else {
      const holder = document.createElement('template')
      holder.innerHTML = html
      const el = holder.content.firstElementChild as HTMLElement
      next.push(el)
      if (!shownChipKeys.has(chip.key) && source === 'text') entering.push({ el, type: chip.type })
    }
    nextKeys.add(chip.key)
  }
  parsePreview.replaceChildren(...next)
  parsePreview.classList.remove('hidden')
  shownChipKeys = nextKeys
  for (const { el, type } of entering) animateChipIn(el, type)
}

// --- Image staging ---

function renderImageGallery(): void {
  imageGallery.innerHTML = ''
  if (pendingImages.length === 0) {
    imageGallery.classList.add('hidden')
    return
  }
  imageGallery.classList.remove('hidden')
  for (const img of pendingImages) {
    const item = document.createElement('div')
    item.className = 'image-gallery-item'
    item.dataset.uuid = img.uuid

    const el = document.createElement('img')
    el.src = img.blobUrl
    el.alt = img.name
    el.draggable = false
    item.appendChild(el)

    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'image-gallery-delete'
    del.title = 'Remove image'
    del.innerHTML = '&times;'
    del.addEventListener('mousedown', (e) => e.preventDefault())
    del.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      removePendingImage(img.uuid)
    })
    item.appendChild(del)

    imageGallery.appendChild(item)
  }
}

function addPendingImage(img: PendingImage): void {
  pendingImages.push(img)
  renderImageGallery()
}

function removePendingImage(uuid: string): void {
  const idx = pendingImages.findIndex((p) => p.uuid === uuid)
  if (idx < 0) return
  URL.revokeObjectURL(pendingImages[idx].blobUrl)
  pendingImages.splice(idx, 1)
  renderImageGallery()
}

function clearPendingImages(): void {
  for (const img of pendingImages) URL.revokeObjectURL(img.blobUrl)
  pendingImages = []
  renderImageGallery()
}

function clearNlpState(): void {
  inputHighlight.innerHTML = ''
  parsePreview.innerHTML = ''
  shownChipKeys = new Set()
  parsePreview.classList.add('hidden')
  lastParseResult = null
  suppressedTypes = new Map()
}

async function saveTask(): Promise<void> {
  const raw = input.value.trim()
  if (!raw) return

  // The notes are plain text: escaped, one <p> per line, the same with or without a link below
  // (description format contract). Empty notes stay null.
  let description: string | null = plainTextToDescriptionHtml(descriptionInput.value) || null

  // Inject Obsidian note link into description. Only now, with the note linked and the task being
  // saved, does main add the uid to the note (D-OBS-1); if that fails the shown link is used.
  if (obsidianLinked && obsidianContext) {
    if (resolvingObsidianLink) return
    resolvingObsidianLink = true
    let link = { deepLink: obsidianContext.deepLink, noteName: obsidianContext.noteName }
    try {
      const resolved = await window.quickEntryApi.resolveObsidianLink()
      if (resolved) link = { deepLink: resolved.deepLink, noteName: resolved.noteName }
    } catch { /* keep the link that was shown */ } finally {
      resolvingObsidianLink = false
    }
    const linkHtml = buildNoteLinkHtml(link.deepLink, link.noteName)
    description = description ? `${description}${linkHtml}` : linkHtml
  }

  // Inject browser page link into description
  if (!obsidianLinked && browserLinked && browserContext) {
    const linkHtml = buildPageLinkHtml(browserContext.url, browserContext.title)
    description = description ? `${description}${linkHtml}` : linkHtml
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
      // A parsed time ("tomorrow at 3pm") is kept; a bare date is date-only. The parse result
      // is only read, never changed: the preview chips keep rendering from it.
      dueDate = parsedDue(lastParseResult.dueDate, lastParseResult.dueHasTime)
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
    // Parser off: only the `!` → today shortcut applies, with the same rule as the other entry
    // points (standalone, leading or trailing `!`; a `!` inside the text is not a date).
    if (exclamationTodayEnabled) {
      const bang = extractBangToday(title)
      if (bang.dueDate) {
        title = bang.title.trim()
        if (!title) return
        dueDate = dueToday()
      }
    }
  }

  input.disabled = true
  descriptionInput.disabled = true
  clearError()

  // Labels and pasted images ride along: if the create has to be queued offline the queue keeps
  // them and replays them after the task exists. Online, they are applied below as before.
  const labelRefs = parsedLabels.map((name) => {
    const match = cachedLabels.find((l) => l.title.toLowerCase() === name.toLowerCase())
    return match ? { id: match.id, title: match.title } : { title: name }
  })
  const imageInputs = pendingImages.map((img) => ({ name: img.name, mime: img.mime, bytes: img.bytes }))
  const result = await window.quickEntryApi.saveTask(title, description || null, dueDate, projectId, priority, repeatAfter, repeatMode, { labels: labelRefs, images: imageInputs })

  if (result.success) {
    const createdTask = result.data as (Record<string, unknown> & { id?: number }) | undefined
    const taskId = createdTask?.id

    // Labels and images go on after the create. A step the network drops is queued, not lost.
    let queuedFollowUps = false
    if (taskId && (labelRefs.length > 0 || imageInputs.length > 0)) {
      const outcome = await applyQuickEntryFollowUps(window.quickEntryApi, {
        taskId,
        title,
        description: description ?? '',
        labels: labelRefs,
        images: imageInputs,
      })
      queuedFollowUps = outcome.queuedLabels + outcome.queuedImages > 0 && !outcome.queueError
    }

    if (result.cached || queuedFollowUps) {
      showOfflineMessage(queuedFollowUps && !result.cached ? 'Task saved \u2014 labels and images will sync when connected' : undefined)
    } else {
      window.quickEntryApi.closeWindow()
    }
  } else {
    // "The task may already exist" is a sentence to read, not a flash: it stays up longer.
    showError(result.error || 'Failed to save task', result.mayExist ? 10_000 : 3000)
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

function applyConfig(cfg: QuickEntryConfig): void {
  exclamationTodayEnabled = cfg.exclamation_today !== false
  projectCycleModifier = cfg.project_cycle_modifier || 'ctrl'
  buildProjectCycle(cfg)
  parserConfig = getParserConfig({ nlp_enabled: cfg.nlp_enabled, nlp_syntax_mode: cfg.nlp_syntax_mode, exclamation_today: cfg.exclamation_today })
  autocomplete.setSyntaxMode(parserConfig.syntaxMode)
  autocomplete.setEnabled(parserConfig.enabled)
}

// When the main process signals the window is shown
window.quickEntryApi.onShowWindow(() => {
  resetInput()

  // Apply cached config synchronously for instant UI
  if (lastConfig) applyConfig(lastConfig)

  // Show animation + focus immediately — no awaits before this
  container.classList.remove('visible')
  void container.offsetHeight
  container.classList.add('visible')
  input.focus()

  // Refresh config, pending count, and labels/projects in the background
  window.quickEntryApi.getConfig().then((cfg) => {
    if (cfg) {
      lastConfig = cfg
      applyConfig(cfg)
    }
  }).catch(() => {})

  updatePendingIndicator().catch(() => {})
  refreshLabelsAndProjects()
})

// When background sync completes, update the pending count
window.quickEntryApi.onSyncCompleted(async () => {
  await updatePendingIndicator()
})

window.quickEntryApi.onDragHover((hovering: boolean) => {
  if (dragHandle) dragHandle.classList.toggle('hover', hovering)
})

// Keyboard handling on title input
input.addEventListener('keydown', async (e) => {
  if (autocomplete.handleKeyDown(e)) return
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

  // Update autocomplete on every input change
  autocomplete.update(raw, input.selectionStart ?? raw.length)

  if (!parserConfig.enabled || !raw) {
    clearNlpState()
    return
  }

  const configWithSuppress: ParserConfig = suppressedTypes.size > 0
    ? { ...parserConfig, suppressTypes: [...suppressedTypes.keys()] }
    : parserConfig
  const result = parse(raw, configWithSuppress)
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
  // Lift suppressions only for types whose raw token text was modified
  if (suppressedTypes.size > 0) {
    const val = input.value
    let changed = false
    for (const [type, rawTexts] of suppressedTypes) {
      if (!rawTexts.every((t) => val.includes(t))) {
        suppressedTypes.delete(type)
        changed = true
      }
    }
    if (changed && suppressedTypes.size === 0) suppressedTypes = new Map()
  }
  handleInputChange()
})

// Image paste — works on both title and description; auto-expands description.
async function handleImagePaste(e: ClipboardEvent): Promise<void> {
  const images = getClipboardImages(e)
  if (images.length === 0) return // allow native text paste
  e.preventDefault()
  if (!isDescriptionExpanded()) expandDescription()
  for (const img of images) {
    try {
      const bytes = await fileToUint8Array(img.file)
      const blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: img.mime }))
      addPendingImage({
        uuid: crypto.randomUUID().slice(0, 8),
        blobUrl,
        bytes,
        name: img.name,
        mime: img.mime,
      })
    } catch {
      showError('Failed to read pasted image')
    }
  }
}

input.addEventListener('paste', handleImagePaste)
descriptionInput.addEventListener('paste', handleImagePaste)

// Obsidian badge remove button
obsidianBadgeRemove.addEventListener('click', () => {
  obsidianLinked = false
  updateObsidianUI()
})

browserBadgeRemove.addEventListener('click', () => {
  browserLinked = false
  updateBrowserUI()
})

// Dismiss parsed token chips — event delegation on the preview container
parsePreview.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.parse-chip-dismiss') as HTMLElement | null
  if (!btn) return
  const tokenType = btn.dataset.type as TokenType | undefined
  if (!tokenType) return
  // Store the raw token texts so we can lift suppression when they're edited
  const rawTexts = lastParseResult?.tokens
    .filter((t) => t.type === tokenType)
    .map((t) => input.value.substring(t.start, t.end)) ?? []
  suppressedTypes.set(tokenType, rawTexts)
  handleInputChange()
  input.focus()
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

// Dates follow the system locale and the Settings clock choice; main sends them and any change.
void initDateFormat(window.quickEntryApi)
subscribeDateFormat(() => {
  if (lastParseResult) renderParsePreview(lastParseResult)
})

// Load config on startup
async function loadInitialConfig(): Promise<void> {
  const cfg = await window.quickEntryApi.getConfig()
  if (cfg) {
    lastConfig = cfg
    applyConfig(cfg)
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

// Keep the window height matched to the container so rounded corners stay visible
// as the description grows or images are added/removed.
const resizeObserver = new ResizeObserver(() => {
  const h = container.offsetHeight
  if (h > 0) window.quickEntryApi.setHeight(h)
})
resizeObserver.observe(container)

export {}
