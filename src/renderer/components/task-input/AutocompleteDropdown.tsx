import { useState, useEffect, useImperativeHandle, forwardRef, useCallback, useId, useRef } from 'react'
import type { SyntaxPrefixes } from '@/lib/task-parser'
import { Popover } from '../overlay/Popover'

interface AutocompleteItem {
  id: number
  title: string
}

type ItemType = 'project' | 'label'

export interface AutocompleteHandle {
  handleKeyDown: (e: React.KeyboardEvent) => boolean
}

/** What the input needs to announce the list: it is a combobox that owns this listbox. */
export interface AutocompleteAria {
  listboxId: string
  /** The id of the highlighted option. */
  activeId: string
}

interface AutocompleteDropdownProps {
  inputValue: string
  cursorPosition: number
  prefixes: SyntaxPrefixes
  projects: AutocompleteItem[]
  labels: AutocompleteItem[]
  onSelect: (item: AutocompleteItem, triggerStart: number, prefix: string) => void
  enabled: boolean
  /** The input the list belongs to; the list opens under the start of the word being typed. */
  inputElement?: HTMLInputElement | HTMLTextAreaElement | null
  /** Called with the listbox and highlighted option while the list is open, null while it is closed. */
  onAriaChange?: (aria: AutocompleteAria | null) => void
}

const MAX_ITEMS = 8

function findTrigger(
  beforeCursor: string,
  prefix: string,
  prefixes: SyntaxPrefixes,
): { start: number; query: string; prefix: string; type: ItemType } | null {
  const lastIdx = beforeCursor.lastIndexOf(prefix)
  if (lastIdx === -1) return null
  if (lastIdx > 0 && beforeCursor[lastIdx - 1] !== ' ') return null

  const query = beforeCursor.substring(lastIdx + prefix.length)
  // If the query contains the prefix again, no trigger
  if (query.includes(prefix)) return null

  const type: ItemType = prefix === prefixes.project ? 'project' : 'label'
  return { start: lastIdx, query, prefix, type }
}

/** Where the text before `index` ends, in pixels from the left edge of a single-line input. */
function caretOffset(input: HTMLInputElement | HTMLTextAreaElement, index: number): number {
  const cs = getComputedStyle(input)
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return 0
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = cs.letterSpacing
  const left = input.offsetLeft + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth)
  return left + ctx.measureText(input.value.slice(0, index)).width - input.scrollLeft
}

/**
 * The project and label suggestions: a listbox on the popover primitive, under the start of the
 * word being typed. Focus stays in the input (the input is the combobox, the highlighted option is
 * its `aria-activedescendant`), so typing and the arrow keys keep working.
 */
export const AutocompleteDropdown = forwardRef<AutocompleteHandle, AutocompleteDropdownProps>(
  function AutocompleteDropdown({ inputValue, cursorPosition, prefixes, projects, labels, onSelect, enabled, inputElement, onAriaChange }, ref) {
    const listboxId = useId()
    const anchorRef = useRef<HTMLSpanElement>(null)
    const [items, setItems] = useState<AutocompleteItem[]>([])
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [visible, setVisible] = useState(false)
    const triggerRef = useRef<{ start: number; prefix: string } | null>(null)
    const [triggerStart, setTriggerStart] = useState(0)
    const [itemType, setItemType] = useState<ItemType>('project')

    // Update dropdown on input/cursor changes
    useEffect(() => {
      if (!enabled) {
        setVisible(false)
        return
      }

      const beforeCursor = inputValue.substring(0, cursorPosition)

      const projTrigger = findTrigger(beforeCursor, prefixes.project, prefixes)
      const labelTrigger = findTrigger(beforeCursor, prefixes.label, prefixes)

      let trigger: ReturnType<typeof findTrigger> = null
      if (projTrigger && labelTrigger) {
        trigger = projTrigger.start > labelTrigger.start ? projTrigger : labelTrigger
      } else {
        trigger = projTrigger || labelTrigger
      }

      if (!trigger) {
        setVisible(false)
        triggerRef.current = null
        return
      }

      triggerRef.current = { start: trigger.start, prefix: trigger.prefix }
      setTriggerStart(trigger.start)
      setItemType(trigger.type)

      const source = trigger.type === 'project' ? projects : labels
      const q = trigger.query.toLowerCase()
      const filtered = q
        ? source.filter((item) => item.title.toLowerCase().includes(q)).slice(0, MAX_ITEMS)
        : source.slice(0, MAX_ITEMS)

      if (filtered.length === 0) {
        setVisible(false)
        return
      }

      setItems(filtered)
      setSelectedIndex(0)
      setVisible(true)
    }, [inputValue, cursorPosition, prefixes, projects, labels, enabled])

    const selectItem = useCallback((index: number) => {
      const item = items[index]
      if (!item || !triggerRef.current) return
      onSelect(item, triggerRef.current.start, triggerRef.current.prefix)
      setVisible(false)
    }, [items, onSelect])

    useImperativeHandle(ref, () => ({
      handleKeyDown(e: React.KeyboardEvent): boolean {
        if (!visible) return false

        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault()
            setSelectedIndex((prev) => (prev + 1) % items.length)
            return true
          case 'ArrowUp':
            e.preventDefault()
            setSelectedIndex((prev) => (prev - 1 + items.length) % items.length)
            return true
          case 'Tab':
            if (items.length > 0) {
              e.preventDefault()
              selectItem(selectedIndex)
              return true
            }
            return false
          case 'Enter':
            if (items.length > 0) {
              // Select the autocomplete item but DON'T consume the event —
              // let Enter propagate to onSubmit so the task is submitted
              // in one keystroke instead of requiring a second Enter press.
              selectItem(selectedIndex)
              return false
            }
            return false
          case 'Escape':
            e.preventDefault()
            setVisible(false)
            return true
          default:
            return false
        }
      },
    }), [visible, items, selectedIndex, selectItem])

    const activeId = `${listboxId}-option-${selectedIndex}`
    useEffect(() => {
      onAriaChange?.(visible ? { listboxId, activeId } : null)
    }, [visible, listboxId, activeId, onAriaChange])
    useEffect(() => () => onAriaChange?.(null), [onAriaChange])

    const typeLabel = itemType === 'project' ? 'project' : 'label'
    const colorMap = {
      project: 'bg-accent-blue/8 dark:bg-accent-blue/15',
      label: 'bg-accent-orange/8 dark:bg-accent-orange/15',
    }

    // The anchor is an empty box at the start of the word, as tall as the input. A textarea (the
    // title editor) wraps, so there the list sits at the left edge.
    const left = inputElement && inputElement.tagName === 'INPUT' ? Math.max(0, caretOffset(inputElement, triggerStart)) : 0

    return (
      <>
        <span
          ref={anchorRef}
          aria-hidden
          className="pointer-events-none absolute top-0 h-full w-px"
          style={{ left }}
        />
        {visible && (
          <Popover
            // A new word starts a new list: mount it again so it is placed under that word.
            key={triggerStart}
            id={listboxId}
            anchorRef={anchorRef}
            onClose={() => setVisible(false)}
            label={itemType === 'project' ? 'Project suggestions' : 'Label suggestions'}
            role="listbox"
            initialFocus="none"
            className="min-w-48 max-w-80 py-1"
          >
            {items.map((item, i) => (
              <div
                key={item.id}
                id={`${listboxId}-option-${i}`}
                role="option"
                aria-selected={i === selectedIndex}
                className={`cursor-pointer px-3 py-1.5 text-[12px] text-[var(--text-primary)] transition-colors ${
                  i === selectedIndex ? colorMap[typeLabel] : 'hover:bg-[var(--bg-hover)]'
                }`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectItem(i)
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                {item.title}
              </div>
            ))}
          </Popover>
        )}
      </>
    )
  },
)
