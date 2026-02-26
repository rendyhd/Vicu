/**
 * Mode-aware autocomplete dropdown for Quick Entry.
 *
 * Trigger characters depend on the active syntax mode:
 *   - Todoist: # → project, @ → label
 *   - Vikunja: + → project, * → label
 */

import { cache } from './vikunja-cache'
import { getPrefixes } from '../lib/task-parser/types'
import type { SyntaxMode } from '../lib/task-parser/types'

interface AutocompleteItem {
  id: number
  title: string
}

type ItemType = 'project' | 'label'

type OnSelectCallback = (
  item: AutocompleteItem,
  triggerStart: number,
  prefix: string,
) => void

export class AutocompleteDropdown {
  private containerEl: HTMLElement
  private listEl: HTMLElement
  private onSelect: OnSelectCallback
  private syntaxMode: SyntaxMode = 'todoist'
  private enabled = true
  private items: AutocompleteItem[] = []
  private itemType: ItemType | null = null
  private activePrefix: string | null = null
  private triggerStart = -1
  private selectedIndex = 0
  private visible = false

  constructor(containerId: string, onSelect: OnSelectCallback) {
    this.containerEl = document.getElementById(containerId)!
    this.listEl = this.containerEl.querySelector('.autocomplete-list')!
    this.onSelect = onSelect

    // Prevent clicks inside the dropdown from stealing focus
    this.containerEl.addEventListener('mousedown', (e) => {
      e.preventDefault()
    })
  }

  setSyntaxMode(mode: SyntaxMode): void {
    this.syntaxMode = mode
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.hide()
  }

  /** Called on every input change to decide whether to show/hide the dropdown. */
  update(inputValue: string, cursorPos: number): void {
    if (!this.enabled) {
      this.hide()
      return
    }

    const prefixes = getPrefixes(this.syntaxMode)
    const beforeCursor = inputValue.substring(0, cursorPos)

    // Find the last trigger character before cursor that starts a token.
    // A valid trigger is at position 0 or preceded by a space.
    const projTrigger = this.findTrigger(beforeCursor, prefixes.project)
    const labelTrigger = this.findTrigger(beforeCursor, prefixes.label)

    // Pick whichever trigger is closer to the cursor (later position)
    let trigger: { start: number; query: string; prefix: string; type: ItemType } | null = null

    if (projTrigger && labelTrigger) {
      trigger = projTrigger.start > labelTrigger.start ? projTrigger : labelTrigger
    } else {
      trigger = projTrigger || labelTrigger
    }

    if (!trigger) {
      this.hide()
      return
    }

    this.activePrefix = trigger.prefix
    this.triggerStart = trigger.start
    this.itemType = trigger.type

    this.items = trigger.type === 'project'
      ? cache.searchProjects(trigger.query)
      : cache.searchLabels(trigger.query)

    if (this.items.length === 0) {
      this.hide()
      return
    }

    this.selectedIndex = 0
    this.render()
    this.show()
  }

  /**
   * Handle keyboard events. Returns true if the event was consumed by the dropdown.
   */
  handleKeyDown(e: KeyboardEvent): boolean {
    if (!this.visible) return false

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        this.selectedIndex = (this.selectedIndex + 1) % this.items.length
        this.render()
        return true

      case 'ArrowUp':
        e.preventDefault()
        this.selectedIndex = (this.selectedIndex - 1 + this.items.length) % this.items.length
        this.render()
        return true

      case 'Tab':
        if (this.items.length > 0) {
          e.preventDefault()
          this.selectCurrent()
          return true
        }
        return false

      case 'Enter':
        if (this.items.length > 0) {
          // Select the autocomplete item but DON'T consume the event —
          // let Enter propagate to saveTask() so the task is submitted
          // in one keystroke instead of requiring a second Enter press.
          this.selectCurrent()
          return false
        }
        return false

      case 'Escape':
        e.preventDefault()
        this.hide()
        return true

      default:
        return false
    }
  }

  isVisible(): boolean {
    return this.visible
  }

  hide(): void {
    this.visible = false
    this.containerEl.classList.add('hidden')
    this.items = []
    this.activePrefix = null
    this.triggerStart = -1
  }

  private show(): void {
    this.visible = true
    this.containerEl.classList.remove('hidden')
  }

  private selectCurrent(): void {
    const item = this.items[this.selectedIndex]
    if (!item || !this.activePrefix) return
    this.onSelect(item, this.triggerStart, this.activePrefix)
    this.hide()
  }

  private render(): void {
    const typeLabel = this.itemType === 'project' ? 'project' : 'label'
    this.listEl.innerHTML = this.items
      .map((item, i) => {
        const active = i === this.selectedIndex ? ' active' : ''
        return `<div class="autocomplete-item autocomplete-item-${typeLabel}${active}" data-index="${i}">${this.escapeHtml(item.title)}</div>`
      })
      .join('')

    // Attach click handlers
    this.listEl.querySelectorAll('.autocomplete-item').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt((el as HTMLElement).dataset.index!, 10)
        this.selectedIndex = idx
        this.selectCurrent()
      })
    })
  }

  private findTrigger(
    beforeCursor: string,
    prefix: string,
  ): { start: number; query: string; prefix: string; type: ItemType } | null {
    // Search backwards for the trigger character
    const lastIdx = beforeCursor.lastIndexOf(prefix)
    if (lastIdx === -1) return null

    // Trigger must be at start of input or preceded by a space
    if (lastIdx > 0 && beforeCursor[lastIdx - 1] !== ' ') return null

    const query = beforeCursor.substring(lastIdx + prefix.length)

    // If there's a space in the query and the token isn't quoted, no trigger
    // (but allow querying with spaces for partial matching — we just check no trigger-breaking chars)
    if (query.includes(prefix)) return null

    const prefixes = getPrefixes(this.syntaxMode)
    const type: ItemType = prefix === prefixes.project ? 'project' : 'label'

    return { start: lastIdx, query, prefix, type }
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}
