import { Plus, Sparkles } from 'lucide-react'
import { useDroppable } from '@dnd-kit/core'
import { QuickFind } from '@/components/sidebar/QuickFind'
import { SmartListNav } from '@/components/sidebar/SmartListNav'
import { ProNav } from '@/components/sidebar/ProNav'
import { FocusBanner } from '@/components/pro/FocusBanner'
import { CustomListNav } from '@/components/sidebar/CustomListNav'
import { ProjectTree } from '@/components/sidebar/ProjectTree'
import { TagList } from '@/components/sidebar/TagList'
import { SidebarFooter } from '@/components/sidebar/SidebarFooter'
import { useSidebarActions } from '@/stores/sidebar-store'
import { projectActions } from '@/stores/project-actions-store'
import { useRootDropActive } from '@/stores/project-drop-store'
import { useAskStore } from '@/stores/ask-store'
import { useAiReady } from '@/hooks/use-ai'
import { shortcutHint } from '@/lib/shortcut-hint'
import { cn } from '@/lib/cn'

const PROJECT_ROOT_ID = 'project-root-sidebar'

/** The PROJECTS header: + adds a project in place, and a project dropped here goes to the top level. */
function ProjectsHeader() {
  const { setNodeRef } = useDroppable({ id: PROJECT_ROOT_ID, data: { type: 'project-root' } })
  const dropActive = useRootDropActive(PROJECT_ROOT_ID)

  return (
    <div ref={setNodeRef} className="px-2 pb-1 pt-3">
      <div
        className={cn(
          'flex items-center justify-between rounded-control px-2',
          dropActive && 'bg-accent-blue/15 ring-1 ring-[var(--accent-blue)]',
        )}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Projects
        </span>
        <button
          type="button"
          onClick={() => projectActions.startCreate(0)}
          className="flex h-5 w-5 items-center justify-center rounded-control text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          aria-label="New project"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

/** Ask, next to Search (docs/ai-assistant.md): shown while Ask is ready; Mod+J does the same. */
function AskButton() {
  const ready = useAiReady()
  const open = useAskStore((s) => s.open)
  if (!ready.ask) return null
  return (
    <button
      type="button"
      aria-label="Ask"
      aria-pressed={open}
      title={`Ask (${shortcutHint('Mod+J', window.api.platform === 'darwin')})`}
      onClick={() => useAskStore.getState().setOpen(!open)}
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-[var(--border-color)] transition-colors',
        open
          ? 'bg-accent-blue/15 text-accent-blue'
          : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
      )}
    >
      <Sparkles className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}

export function Sidebar() {
  const { openLabelDialog } = useSidebarActions()

  return (
    <div className="isolate flex h-full flex-col">
      <div className="flex items-center gap-1.5 px-2 pt-2">
        <div role="search" className="min-w-0 flex-1">
          <QuickFind />
        </div>
        <AskButton />
      </div>

      <SmartListNav />
      <FocusBanner />
      <ProNav />

      <div className="mx-4 border-t border-[var(--border-color)]" />

      <div className="flex-1 overflow-y-auto">
        <ProjectsHeader />
        <ProjectTree />

        <div className="mx-4 mt-2 border-t border-[var(--border-color)]" />

        <CustomListNav />

        <div className="mx-4 mt-2 border-t border-[var(--border-color)]" />

        <div className="px-4 pb-1 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Labels
            </span>
            <button
              type="button"
              onClick={() => openLabelDialog()}
              className="flex h-5 w-5 items-center justify-center rounded-control text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-label="New label"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <TagList />
      </div>

      <SidebarFooter />
    </div>
  )
}
