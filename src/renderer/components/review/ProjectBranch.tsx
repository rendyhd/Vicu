import { useState } from 'react'
import { ChevronRight, MoreHorizontal, Plus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { normalizeHex } from '@/lib/constants'
import { formatStalenessPill } from '@/lib/review-metadata'
import { useSetReviewCadence, useExcludeFromReview, type ReviewTreeNode } from '@/hooks/use-review'
import { useProjectTasks } from '@/hooks/use-project-tasks'
import { useCreateTask } from '@/hooks/use-task-mutations'
import { TaskRow } from '@/components/task-list/TaskRow'

interface ProjectBranchProps {
  node: ReviewTreeNode
  depth: number
  expandedIds: Set<number>
  onToggle: (id: number) => void
  reviewedIds: ReadonlySet<number>
  onMarkReviewed: (node: ReviewTreeNode) => void
  focusedId: number | null
  onFocus: (id: number) => void
}

export function ProjectBranch({
  node,
  depth,
  expandedIds,
  onToggle,
  reviewedIds,
  onMarkReviewed,
  focusedId,
  onFocus,
}: ProjectBranchProps) {
  const isOpen = expandedIds.has(node.project.id)
  const isReviewed = reviewedIds.has(node.project.id)
  const hasChildren = node.children.length > 0

  return (
    <div style={{ position: 'relative' }}>
      {depth > 0 && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: -12,
            top: 0,
            bottom: isOpen ? 0 : '50%',
            width: 1,
            background: 'var(--border-color)',
          }}
        />
      )}
      {depth > 0 && (
        <span
          aria-hidden
          style={{ position: 'absolute', left: -12, top: 22, width: 10, height: 1, background: 'var(--border-color)' }}
        />
      )}

      <ProjectHeader
        node={node}
        depth={depth}
        isOpen={isOpen}
        isReviewed={isReviewed}
        isFocused={focusedId === node.project.id}
        onToggle={() => {
          onFocus(node.project.id)
          onToggle(node.project.id)
        }}
        onMarkReviewed={() => onMarkReviewed(node)}
      />

      {isOpen && (
        <ProjectReviewTasks projectId={node.project.id} depth={depth} />
      )}

      {hasChildren && (
        <div style={{ marginLeft: depth * 18 + 26, position: 'relative' }}>
          {node.children.map((child) => (
            <ProjectBranch
              key={child.project.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggle={onToggle}
              reviewedIds={reviewedIds}
              onMarkReviewed={onMarkReviewed}
              focusedId={focusedId}
              onFocus={onFocus}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface ProjectHeaderProps {
  node: ReviewTreeNode
  depth: number
  isOpen: boolean
  isReviewed: boolean
  isFocused: boolean
  onToggle: () => void
  onMarkReviewed: () => void
}

function ProjectHeader({ node, depth, isOpen, isReviewed, isFocused, onToggle, onMarkReviewed }: ProjectHeaderProps) {
  const { project } = node
  const dotColor = normalizeHex(project.hex_color) || '#8E8E93'
  const subCount = node.children.length

  return (
    <div
      onClick={onToggle}
      data-review-project={project.id}
      className={cn('group', isFocused && 'ring-1 ring-[var(--accent-purple)]')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 8,
        marginLeft: depth * 18,
        marginBottom: 2,
        background: isOpen ? 'var(--bg-hover)' : 'transparent',
        cursor: 'pointer',
        opacity: isReviewed ? 0.45 : 1,
      }}
    >
      <ChevronRight
        width={12}
        height={12}
        style={{
          color: 'var(--text-secondary)',
          flexShrink: 0,
          transform: isOpen ? 'rotate(90deg)' : 'none',
          transition: 'transform 0.15s',
        }}
      />
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: depth ? 5 : 2,
          background: dotColor,
          flexShrink: 0,
          opacity: depth ? 0.6 : 1,
        }}
      />
      <span
        className="truncate"
        style={{ fontSize: depth ? 13 : 14, fontWeight: depth ? 500 : 600, color: 'var(--text-primary)' }}
      >
        {project.title}
      </span>
      {depth === 0 && subCount > 0 && (
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {subCount} sub-project{subCount === 1 ? '' : 's'}
        </span>
      )}
      {!isReviewed && <StalenessPill node={node} />}
      <span style={{ flex: 1 }} />
      {!isReviewed ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onMarkReviewed()
          }}
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '4px 10px',
            borderRadius: 6,
            background: 'transparent',
            color: 'var(--accent-purple)',
            border: '1px solid rgba(175,82,222,0.4)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            flexShrink: 0,
          }}
        >
          ✓ Mark reviewed
        </button>
      ) : (
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--accent-green)',
            padding: '4px 10px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            flexShrink: 0,
          }}
        >
          ✓ Reviewed
        </span>
      )}
      <ProjectRowMenu node={node} />
    </div>
  )
}

function StalenessPill({ node }: { node: ReviewTreeNode }) {
  const pill = formatStalenessPill(node.status)
  const tones = {
    red: { background: 'rgba(255,59,48,0.12)', color: 'var(--accent-red)' },
    orange: { background: 'rgba(255,149,0,0.12)', color: 'var(--accent-orange)' },
    gray: { background: 'var(--bg-hover)', color: 'var(--text-secondary)' },
  }
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: '2px 7px',
        borderRadius: 999,
        flexShrink: 0,
        ...tones[pill.tone],
      }}
    >
      {pill.text}
    </span>
  )
}

// Preserves the per-project cadence + exclude actions from the old flat list.
function ProjectRowMenu({ node }: { node: ReviewTreeNode }) {
  const [open, setOpen] = useState(false)
  const [cadenceOpen, setCadenceOpen] = useState(false)
  const [cadenceInput, setCadenceInput] = useState(String(node.status.metadata.cadenceDaysOverride ?? ''))
  const setCadence = useSetReviewCadence()
  const exclude = useExcludeFromReview()

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-tertiary)] opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] group-hover:opacity-100"
        title="Review options"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && !cadenceOpen && (
        <div
          className="absolute right-0 top-full z-20 mt-1 w-48 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] py-1 shadow-lg"
          onMouseLeave={() => setOpen(false)}
        >
          <button
            type="button"
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--bg-hover)]"
            onClick={() => setCadenceOpen(true)}
          >
            Set cadence…
          </button>
          <button
            type="button"
            className="w-full px-3 py-1.5 text-left text-sm text-[var(--accent-red)] hover:bg-[var(--bg-hover)]"
            onClick={() => {
              setOpen(false)
              exclude.mutate({ project: node.project, excluded: true })
            }}
          >
            Exclude from review
          </button>
        </div>
      )}
      {cadenceOpen && (
        <div className="absolute right-0 top-full z-20 mt-1 w-52 space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 shadow-lg">
          <label className="block text-xs text-[var(--text-secondary)]">Cadence in days (blank = default)</label>
          <input
            type="number"
            min={1}
            max={365}
            value={cadenceInput}
            onChange={(e) => setCadenceInput(e.target.value)}
            className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 rounded bg-[var(--accent-blue)] px-2 py-1 text-sm text-white"
              onClick={() => {
                const n = cadenceInput === '' ? null : parseInt(cadenceInput, 10)
                setCadence.mutate({ project: node.project, cadenceDays: Number.isFinite(n ?? NaN) ? n : null })
                setCadenceOpen(false)
                setOpen(false)
              }}
            >
              Save
            </button>
            <button
              type="button"
              className="rounded border border-[var(--border-color)] px-2 py-1 text-sm"
              onClick={() => {
                setCadenceOpen(false)
                setOpen(false)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ProjectReviewTasks({ projectId, depth }: { projectId: number; depth: number }) {
  const { data: tasks, isLoading } = useProjectTasks(projectId)

  return (
    <div style={{ paddingLeft: 26 + depth * 18, paddingRight: 4, paddingBottom: 8 }}>
      {isLoading && <div className="px-2 py-1 text-xs text-[var(--text-secondary)]">Loading…</div>}
      {!isLoading && tasks.length === 0 && (
        <div className="px-2 py-1 text-xs text-[var(--text-tertiary)]">No open tasks.</div>
      )}
      {!isLoading && tasks.map((task) => <TaskRow key={task.id} task={task} />)}
      <AddTaskInline projectId={projectId} />
    </div>
  )
}

function AddTaskInline({ projectId }: { projectId: number }) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const createTask = useCreateTask()

  const submit = () => {
    const trimmed = title.trim()
    if (trimmed) {
      createTask.mutate({ projectId, task: { title: trimmed } })
      setTitle('')
    }
  }

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mt-0.5 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <Plus className="h-3 w-3" /> Add task
      </button>
    )
  }

  return (
    <input
      autoFocus
      value={title}
      placeholder="Task title, Enter to add"
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          submit()
        }
        if (e.key === 'Escape') {
          setTitle('')
          setAdding(false)
        }
      }}
      onBlur={() => {
        if (!title.trim()) setAdding(false)
      }}
      className="mt-1 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none"
    />
  )
}
