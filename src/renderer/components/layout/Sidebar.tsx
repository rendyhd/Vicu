import { Plus } from 'lucide-react'
import { SmartListNav } from '@/components/sidebar/SmartListNav'
import { CustomListNav } from '@/components/sidebar/CustomListNav'
import { ProjectTree } from '@/components/sidebar/ProjectTree'
import { TagList } from '@/components/sidebar/TagList'
import { SidebarFooter } from '@/components/sidebar/SidebarFooter'
import { useSidebarActions } from '@/stores/sidebar-store'

export function Sidebar() {
  const { openProjectDialog, openLabelDialog } = useSidebarActions()

  return (
    <div className="flex h-full flex-col">
      <SmartListNav />

      <div className="mx-4 border-t border-[var(--border-color)]" />

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pb-1 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Projects
            </span>
            <button
              type="button"
              onClick={() => openProjectDialog()}
              className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-label="New project"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <ProjectTree />

        <div className="mx-4 mt-2 border-t border-[var(--border-color)]" />

        <CustomListNav />

        <div className="mx-4 mt-2 border-t border-[var(--border-color)]" />

        <div className="px-4 pb-1 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Tags
            </span>
            <button
              type="button"
              onClick={() => openLabelDialog()}
              className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              aria-label="New tag"
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
