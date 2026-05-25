import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  useReviewTree,
  flattenReviewTree,
  useMarkReviewed,
  type ReviewTreeNode,
} from '@/hooks/use-review'
import { useUpdateProject } from '@/hooks/use-task-mutations'
import { useAppConfig } from '@/hooks/use-app-config'
import { useSelectionStore } from '@/stores/selection-store'
import { ProjectBranch } from '@/components/review/ProjectBranch'
import type { Project } from '@/lib/vikunja-types'

type Tab = 'due' | 'all'

interface ToastState {
  projectId: number
  title: string
  prevProject: Project
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

export function ReviewView() {
  const [tab, setTab] = useState<Tab>('due')
  const [reviewedThisSession, setReviewedThisSession] = useState<ReadonlySet<number>>(new Set())
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [focusedId, setFocusedId] = useState<number | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  const due = useReviewTree('due', reviewedThisSession)
  const all = useReviewTree('all', reviewedThisSession)
  const markReviewed = useMarkReviewed()
  const updateProject = useUpdateProject()
  const collapseTasks = useSelectionStore((s) => s.collapseAll)
  const { data: cfg } = useAppConfig()
  const defaultCadence = cfg?.review?.default_cadence_days ?? 14

  const currentTree = tab === 'due' ? due.data : all.data
  const isLoading = tab === 'due' ? due.isLoading : all.isLoading

  // Progress reflects the review workload (the "due" set), independent of tab.
  const { total, done } = useMemo(() => {
    const flat = flattenReviewTree(due.data)
    const workload = flat.filter((n) => n.status.isOverdue || reviewedThisSession.has(n.project.id))
    return {
      total: workload.length,
      done: workload.filter((n) => reviewedThisSession.has(n.project.id)).length,
    }
  }, [due.data, reviewedThisSession])
  const remaining = total - done

  const navList = useMemo(() => flattenReviewTree(currentTree), [currentTree])

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (t: ToastState) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(t)
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }

  const handleMarkReviewed = (node: ReviewTreeNode) => {
    const prevProject = node.project
    markReviewed.mutate({ project: prevProject })
    setReviewedThisSession((prev) => new Set(prev).add(prevProject.id))
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.delete(prevProject.id)
      return next
    })
    showToast({ projectId: prevProject.id, title: prevProject.title, prevProject })

    // Advance focus to the next still-due project.
    const list = navList
    const idx = list.findIndex((n) => n.project.id === prevProject.id)
    const nextDue = list
      .slice(idx + 1)
      .find((n) => n.status.isOverdue && !reviewedThisSession.has(n.project.id) && n.project.id !== prevProject.id)
    if (nextDue) setFocusedId(nextDue.project.id)
  }

  const handleUndo = () => {
    if (!toast) return
    updateProject.mutate({ id: toast.projectId, project: toast.prevProject })
    setReviewedThisSession((prev) => {
      const next = new Set(prev)
      next.delete(toast.projectId)
      return next
    })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(null)
  }

  const collapseEverything = () => {
    setExpandedIds(new Set())
    collapseTasks()
  }

  // Keyboard model — refs keep a single listener reading the latest state.
  const kbd = useRef({ navList, focusedId, handleMarkReviewed, toggleExpand, collapseEverything })
  kbd.current = { navList, focusedId, handleMarkReviewed, toggleExpand, collapseEverything }

  useEffect(() => {
    const moveFocus = (delta: number) => {
      const list = kbd.current.navList
      if (list.length === 0) return
      const i = list.findIndex((n) => n.project.id === kbd.current.focusedId)
      const next = i === -1 ? (delta > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, i + delta))
      const id = list[next].project.id
      setFocusedId(id)
      document.querySelector(`[data-review-project="${id}"]`)?.scrollIntoView({ block: 'nearest' })
    }
    const focusedNode = () => kbd.current.navList.find((n) => n.project.id === kbd.current.focusedId) ?? null

    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isEditableTarget(e.target)) return
      switch (e.key) {
        case 'j':
        case 'J':
        case 'ArrowDown':
          e.preventDefault()
          moveFocus(1)
          break
        case 'k':
        case 'K':
        case 'ArrowUp':
          e.preventDefault()
          moveFocus(-1)
          break
        case 'Enter':
        case ' ': {
          const node = focusedNode()
          if (node) {
            e.preventDefault()
            kbd.current.toggleExpand(node.project.id)
          }
          break
        }
        case 'r':
        case 'R': {
          const node = focusedNode()
          if (node) {
            e.preventDefault()
            kbd.current.handleMarkReviewed(node)
          }
          break
        }
        case 'Escape':
          kbd.current.collapseEverything()
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  const allCaughtUp = tab === 'due' && !isLoading && currentTree.length === 0

  return (
    <div className="relative flex h-full flex-col" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div style={{ padding: '20px 28px 14px', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <RefreshCw width={20} height={20} style={{ color: 'var(--accent-purple)' }} />
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>
            Review
          </h1>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 999,
              background: 'rgba(175,82,222,0.15)',
              color: 'var(--accent-purple)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {remaining} due
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Click a project to review tasks in place. Press{' '}
          <kbd
            style={{
              fontFamily: '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
              fontSize: 10,
              padding: '1px 5px',
              borderRadius: 3,
              background: 'var(--bg-hover)',
              border: '1px solid var(--border-color)',
            }}
          >
            R
          </kbd>{' '}
          to mark reviewed.
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }} role="tablist">
          <TabButton active={tab === 'due'} onClick={() => setTab('due')}>
            Due
          </TabButton>
          <TabButton active={tab === 'all'} onClick={() => setTab('all')}>
            All tracked
          </TabButton>
        </div>

        {/* Progress */}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--bg-hover)', overflow: 'hidden' }}>
            <div
              style={{
                width: total > 0 ? `${(done / total) * 100}%` : '0%',
                height: '100%',
                background: 'var(--accent-purple)',
                transition: 'width 0.3s',
              }}
            />
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
            {done} / {total}
          </span>
        </div>
      </div>

      {/* Tree list */}
      <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 24px' }}>
        {isLoading && <div className="px-2 py-4 text-sm text-[var(--text-secondary)]">Loading…</div>}

        {allCaughtUp && (
          <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
            <RefreshCw className="mb-3 h-12 w-12" style={{ color: 'var(--accent-green)' }} />
            <p style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)' }}>All reviewed</p>
            <p className="mt-1 max-w-sm" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              You&apos;re caught up. Next review available in {defaultCadence} days.
            </p>
          </div>
        )}

        {!isLoading && !allCaughtUp && currentTree.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
            <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)' }}>No tracked projects</p>
            <p className="mt-1 max-w-sm" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Projects appear here once review tracking is enabled in Settings.
            </p>
          </div>
        )}

        {!isLoading &&
          currentTree.map((node) => (
            <ProjectBranch
              key={node.project.id}
              node={node}
              depth={0}
              expandedIds={expandedIds}
              onToggle={toggleExpand}
              reviewedIds={reviewedThisSession}
              onMarkReviewed={handleMarkReviewed}
              focusedId={focusedId}
              onFocus={setFocusedId}
            />
          ))}
      </div>

      {/* Undo toast */}
      {toast && (
        <div
          className="absolute left-1/2 -translate-x-1/2"
          style={{
            bottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '8px 12px 8px 14px',
            borderRadius: 8,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            fontSize: 13,
            color: 'var(--text-primary)',
            zIndex: 30,
          }}
        >
          <span>
            Marked <strong>{toast.title}</strong> reviewed
          </span>
          <button
            type="button"
            onClick={handleUndo}
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-purple)', cursor: 'pointer' }}
          >
            Undo
          </button>
        </div>
      )}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn('rounded-md px-3 py-1 text-[13px] font-medium transition-colors')}
      style={
        active
          ? { background: 'rgba(175,82,222,0.15)', color: 'var(--accent-purple)' }
          : { background: 'transparent', color: 'var(--text-secondary)' }
      }
    >
      {children}
    </button>
  )
}
