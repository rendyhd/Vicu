import { useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Popover } from '@/components/overlay/Popover'
import { flattenTree } from '@/components/task-list/ProjectPickerPopover'
import { useProjects } from '@/hooks/use-projects'
import { cn } from '@/lib/cn'
import { normalizeHex } from '@/lib/constants'
import { sourceLists, sourceProjectId, type PlanSource } from '@/lib/plan-source'

interface SourceMenuProps {
  source: PlanSource
  /** The list's name for the selected day ("Today, no time"). */
  dayLabel: string
  label: string
  count: number
  inboxId: number
  onChange: (source: PlanSource) => void
}

/** Top of the left panel: which list the tasks to plan come from, its lists and every project. */
export function SourceMenu({ source, dayLabel, label, count, inboxId, onChange }: SourceMenuProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const anchorRef = useRef<HTMLButtonElement>(null)
  const { data: projects } = useProjects()

  const needle = query.trim().toLowerCase()
  const lists = useMemo(() => sourceLists(dayLabel).filter((item) => item.label.toLowerCase().includes(needle)), [dayLabel, needle])
  const rows = useMemo(() => {
    const all = flattenTree(projects?.tree ?? []).filter(({ node }) => node.id !== inboxId)
    if (!needle) return all
    return all.filter(({ node }) => node.title.toLowerCase().includes(needle)).map((row) => ({ ...row, depth: 0 }))
  }, [projects, inboxId, needle])

  const choose = (next: PlanSource) => {
    onChange(next)
    setOpen(false)
    setQuery('')
  }
  const current = sourceProjectId(source, 0)

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        data-plan-source
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 w-full items-center gap-2 rounded-control border border-border bg-bg-card px-3 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-meta font-medium text-text">{label}</span>
        <span className="text-meta text-text-secondary">{count}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
      </button>
      {open && (
        <Popover
          anchorRef={anchorRef}
          invokedBy={[anchorRef]}
          label="Tasks to plan from"
          role="dialog"
          onClose={() => {
            setOpen(false)
            setQuery('')
          }}
          className="max-h-[420px] w-80 overflow-y-auto p-1.5"
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a list or project"
            aria-label="Find a list or project"
            className="mb-1 w-full rounded-control border border-border bg-transparent px-2 py-1.5 text-meta text-text placeholder:text-text-secondary"
          />
          {lists.length > 0 && <p className="px-2 pb-0.5 pt-1 text-caption text-text-secondary">Lists</p>}
          {lists.map((item) => (
            <button
              key={item.source}
              type="button"
              data-plan-source-item={item.source}
              onClick={() => choose(item.source)}
              className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-meta text-text hover:bg-bg-hover"
            >
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {source === item.source && <Check className="h-3.5 w-3.5 shrink-0 text-accent-blue" aria-hidden="true" />}
            </button>
          ))}
          {rows.length > 0 && <p className="px-2 pb-0.5 pt-2 text-caption text-text-secondary">Projects</p>}
          {rows.map(({ node, depth }) => (
            <button
              key={node.id}
              type="button"
              data-plan-source-item={`project:${node.id}`}
              onClick={() => choose(`project:${node.id}`)}
              style={{ paddingLeft: 8 + depth * 14 }}
              className={cn('flex w-full items-center gap-2 rounded-control py-1.5 pr-2 text-left text-meta text-text hover:bg-bg-hover')}
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: normalizeHex(node.hex_color) ?? 'var(--text-secondary)' }}
              />
              <span className="min-w-0 flex-1 truncate">{node.title}</span>
              {current === node.id && <Check className="h-3.5 w-3.5 shrink-0 text-accent-blue" aria-hidden="true" />}
            </button>
          ))}
          {lists.length === 0 && rows.length === 0 && (
            <p className="px-2 py-2 text-meta text-text-secondary">Nothing with that name.</p>
          )}
        </Popover>
      )}
    </>
  )
}
