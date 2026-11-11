import { useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Popover } from '@/components/overlay/Popover'
import { flattenTree } from '@/components/task-list/ProjectPickerPopover'
import { useProjects } from '@/hooks/use-projects'
import { cn } from '@/lib/cn'
import { normalizeHex } from '@/lib/constants'
import { sourceLists, sourceProjectId, type PlanSource } from '@/lib/plan-source'

type ListSource = Exclude<PlanSource, `project:${number}`>

interface SourceChipsProps {
  source: PlanSource
  /** The selected day's name ("Today", "Tomorrow", "Fri 6 Nov"): the chip of that day's tasks without a time. */
  dayLabel: string
  /** How many tasks each list holds; a list left out has no count (it would need a request of its own). */
  counts: Partial<Record<ListSource, number>>
  /** The selected project's name and count, when a project is the source. */
  projectLabel?: string
  projectCount?: number
  inboxId: number
  onChange: (source: PlanSource) => void
}

const CHIP = 'flex h-7 max-w-full items-center gap-1.5 rounded-chip border px-2.5 text-chip'
const chipState = (selected: boolean) =>
  selected ? 'border-accent-blue bg-accent-blue/12 text-accent-blue' : 'border-border text-text hover:bg-bg-hover'

function Count({ value, selected }: { value: number | undefined; selected: boolean }) {
  if (value === undefined) return null
  return <span className={selected ? 'text-accent-blue' : 'text-text-secondary'}>{value}</span>
}

/**
 * Top of the left panel: which list the tasks to plan come from. A chip per list with its count, and
 * Project, which opens a search over every project.
 */
export function SourceChips({ source, dayLabel, counts, projectLabel, projectCount, inboxId, onChange }: SourceChipsProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const anchorRef = useRef<HTMLButtonElement>(null)
  const { data: projects } = useProjects()

  const needle = query.trim().toLowerCase()
  const rows = useMemo(() => {
    const all = flattenTree(projects?.tree ?? []).filter(({ node }) => node.id !== inboxId)
    if (!needle) return all
    return all.filter(({ node }) => node.title.toLowerCase().includes(needle)).map((row) => ({ ...row, depth: 0 }))
  }, [projects, inboxId, needle])

  const close = () => {
    setOpen(false)
    setQuery('')
  }
  const choose = (next: PlanSource) => {
    onChange(next)
    close()
  }
  const isProject = source.startsWith('project:')
  const current = isProject ? sourceProjectId(source, 0) : null

  return (
    <div role="group" aria-label="Tasks to plan from" className="flex flex-wrap gap-1.5" data-plan-source>
      {sourceLists(dayLabel).map((item) => {
        const selected = source === item.source
        const count = counts[item.source as ListSource]
        return (
          <button
            key={item.source}
            type="button"
            data-plan-source-item={item.source}
            aria-pressed={selected}
            onClick={() => onChange(item.source)}
            className={cn(CHIP, chipState(selected))}
          >
            {/* Named by what it shows ("Today 3"), so a spoken command finds it. */}
            <span className="min-w-0 truncate">{item.label}</span>{' '}
            <Count value={count} selected={selected} />
          </button>
        )
      })}
      <button
        ref={anchorRef}
        type="button"
        data-plan-source-project
        aria-pressed={isProject}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(CHIP, chipState(isProject))}
      >
        {isProject && projectLabel && <span className="sr-only">Project: </span>}
        <span className="min-w-0 truncate">{isProject && projectLabel ? projectLabel : 'Project'}</span>{' '}
        {isProject && <Count value={projectCount} selected />}
        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      </button>
      {open && (
        <Popover
          anchorRef={anchorRef}
          invokedBy={[anchorRef]}
          label="Plan from a project"
          role="dialog"
          onClose={close}
          className="max-h-[420px] w-80 overflow-y-auto p-1.5"
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a project"
            aria-label="Find a project"
            className="mb-1 w-full rounded-control border border-border bg-transparent px-2 py-1.5 text-meta text-text placeholder:text-text-secondary"
          />
          {rows.map(({ node, depth }) => (
            <button
              key={node.id}
              type="button"
              data-plan-source-item={`project:${node.id}`}
              onClick={() => choose(`project:${node.id}`)}
              style={{ paddingLeft: 8 + depth * 14 }}
              className="flex w-full items-center gap-2 rounded-control py-1.5 pr-2 text-left text-meta text-text hover:bg-bg-hover"
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
          {rows.length === 0 && <p className="px-2 py-2 text-meta text-text-secondary">No project with that name.</p>}
        </Popover>
      )}
    </div>
  )
}
