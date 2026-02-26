import { useState, useEffect, useImperativeHandle, forwardRef, useCallback, useRef } from 'react'
import type { SyntaxPrefixes } from '@/lib/task-parser'

interface AutocompleteItem {
  id: number
  title: string
}

type ItemType = 'project' | 'label'

export interface AutocompleteHandle {
  handleKeyDown: (e: React.KeyboardEvent) => boolean
}

interface AutocompleteDropdownProps {
  inputValue: string
  cursorPosition: number
  prefixes: SyntaxPrefixes
  projects: AutocompleteItem[]
  labels: AutocompleteItem[]
  onSelect: (item: AutocompleteItem, triggerStart: number, prefix: string) => void
  enabled: boolean
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

export const AutocompleteDropdown = forwardRef<AutocompleteHandle, AutocompleteDropdownProps>(
  function AutocompleteDropdown({ inputValue, cursorPosition, prefixes, projects, labels, onSelect, enabled }, ref) {
    const [items, setItems] = useState<AutocompleteItem[]>([])
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [visible, setVisible] = useState(false)
    const triggerRef = useRef<{ start: number; prefix: string } | null>(null)
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

    if (!visible) return null

    const typeLabel = itemType === 'project' ? 'project' : 'label'
    const colorMap = {
      project: 'bg-[rgba(59,130,246,0.08)] dark:bg-[rgba(59,130,246,0.15)]',
      label: 'bg-[rgba(249,115,22,0.08)] dark:bg-[rgba(249,115,22,0.15)]',
    }

    return (
      <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-lg">
        {items.map((item, i) => (
          <div
            key={item.id}
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
      </div>
    )
  },
)
