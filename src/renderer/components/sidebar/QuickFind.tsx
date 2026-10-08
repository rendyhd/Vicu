import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { Search } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { cn } from '@/lib/cn'
import { useQuickFindTasks } from '@/hooks/use-quick-find'
import { useOpenTask } from '@/hooks/use-open-task'
import { useProjects } from '@/hooks/use-projects'
import { useFloatingPopover } from '@/components/overlay/use-floating-popover'
import { nextOptionIndex } from '@/components/overlay/popover-logic'
import type { Task } from '@/lib/vikunja-types'

const isMac = () => window.api.platform === 'darwin'

/**
 * Quick find, at the top of the sidebar. Ctrl+F (Command+F) focuses it. Matching tasks list as you
 * type: the cached ones at once, the server's answer merged in after typing pauses. Arrow keys move
 * through the results (focus stays in the field), Enter opens the highlighted task, or shows the
 * full search page when there is none. Escape clears the field, and then gives focus back to where
 * it was before Ctrl+F.
 */
export function QuickFind() {
  const inputRef = useRef<HTMLInputElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(0)
  const { tasks, pending } = useQuickFindTasks(query)
  const { data: projects } = useProjects()
  const openTask = useOpenTask()
  const navigate = useNavigate()
  const listId = useId()

  const trimmed = query.trim()
  const open = focused && trimmed !== ''
  // The last row is always "all results", so Enter always has somewhere to go.
  const rowCount = tasks.length + 1
  const activeIndex = Math.min(active, rowCount - 1)
  const optionId = (index: number) => `${listId}-${index}`

  // Ctrl+F from anywhere in the window.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        const current = document.activeElement
        if (current instanceof HTMLElement && current !== inputRef.current && current !== document.body) previousFocus.current = current
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const finish = () => {
    setQuery('')
    setActive(0)
    inputRef.current?.blur()
  }

  const showAll = () => {
    if (trimmed === '') return
    void navigate({ to: '/search', search: { q: trimmed } })
    finish()
  }

  const choose = (index: number) => {
    const task = tasks[index]
    if (!task) return showAll()
    openTask(task.id)
    finish()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (query !== '') {
        setQuery('')
      } else {
        inputRef.current?.blur()
        const back = previousFocus.current
        previousFocus.current = null
        if (back?.isConnected) back.focus({ preventScroll: true })
      }
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (open) choose(activeIndex)
      return
    }
    if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      const next = nextOptionIndex(activeIndex, rowCount, event.key)
      if (next !== null) setActive(next)
    }
  }

  const projectTitle = (task: Task) => projects?.all.find((project) => project.id === task.project_id)?.title ?? ''

  return (
    <div className="relative">
      <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-secondary)]" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Quick find"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        value={query}
        placeholder="Quick find"
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        className="h-8 w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] pl-8 pr-12 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
      />
      {query === '' && (
        <kbd aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-sans text-caption text-[var(--text-secondary)]">
          {isMac() ? '⌘F' : 'Ctrl+F'}
        </kbd>
      )}
      {open && (
        <Results
          anchor={inputRef}
          listId={listId}
          tasks={tasks}
          query={trimmed}
          pending={pending}
          activeIndex={activeIndex}
          optionId={optionId}
          projectTitle={projectTitle}
          onHover={setActive}
          onChoose={choose}
        />
      )}
    </div>
  )
}

interface ResultsProps {
  anchor: RefObject<HTMLInputElement | null>
  listId: string
  tasks: Task[]
  query: string
  pending: boolean
  activeIndex: number
  optionId: (index: number) => string
  projectTitle: (task: Task) => string
  onHover: (index: number) => void
  onChoose: (index: number) => void
}

function Results({ anchor, listId, tasks, query, pending, activeIndex, optionId, projectTitle, onHover, onChoose }: ResultsProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  useFloatingPopover(anchor, panelRef, { placement: 'bottom-start' })

  // The highlighted row stays in view as the arrows move.
  useEffect(() => {
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, optionId])

  const rows = [
    ...tasks.map((task) => ({ key: `task-${task.id}`, title: task.title, detail: projectTitle(task), done: task.done, all: false })),
    { key: 'all', title: `Search all tasks for “${query}”`, detail: '', done: false, all: true },
  ]
  const summary = `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}${pending ? ', still searching' : ''}`

  return (
    <>
      <div
        ref={panelRef}
        id={listId}
        popover="manual"
        role="listbox"
        aria-label="Quick find results"
        // Clicking a result must not take focus from the field.
        onMouseDown={(event) => event.preventDefault()}
        className="m-0 inset-auto w-[360px] overflow-y-auto rounded-popover border border-[var(--border-color)] bg-[var(--bg-primary)] py-1 text-[var(--text-primary)] shadow-lg"
      >
        {rows.map((row, index) => (
          <div
            key={row.key}
            id={optionId(index)}
            role="option"
            aria-selected={index === activeIndex}
            onMouseMove={() => onHover(index)}
            onClick={() => onChoose(index)}
            className={cn(
              'flex cursor-default items-center gap-2 px-3 py-1.5 text-xs',
              index === activeIndex && 'bg-[var(--bg-hover)]',
              row.all && 'text-[var(--text-secondary)]',
            )}
          >
            {row.all && <Search aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
            <span className={cn('min-w-0 flex-1 truncate', row.done && 'text-[var(--text-secondary)] line-through')}>{row.title}</span>
            {row.detail && <span className="max-w-[40%] shrink-0 truncate text-caption text-[var(--text-secondary)]">{row.detail}</span>}
          </div>
        ))}
      </div>
      <div role="status" className="sr-only">{summary}</div>
    </>
  )
}
