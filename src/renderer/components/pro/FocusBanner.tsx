import { useRef } from 'react'
import { Crosshair, X } from 'lucide-react'
import { Dialog } from '@/components/overlay/Dialog'
import { Checkbox } from '@/components/shared/Checkbox'
import { useFocus } from '@/hooks/use-focus'
import { useProjects } from '@/hooks/use-projects'
import { useProjectCategories } from '@/hooks/use-project-categories'
import { useAppConfig } from '@/hooks/use-app-config'
import { useProUiStore } from '@/stores/pro-ui-store'
import { usePro } from '@/hooks/use-pro'

/** The sidebar line while a focus is set (21.14): what is in focus, Change and Clear. */
export function FocusBanner() {
  const { focus, setFocus } = useFocus()
  const { categories } = useProjectCategories()
  const { data: projects } = useProjects()
  const open = useProUiStore((s) => s.setFocusPickerOpen)
  if (!focus) return null
  const names = [
    ...focus.categories.map((id) => categories.find((category) => category.id === id)?.name).filter(Boolean),
    ...focus.projects.map((id) => projects?.all.find((project) => project.id === id)?.title).filter(Boolean),
  ] as string[]
  return (
    <div className="mx-2 mb-1 flex items-center gap-2 rounded-control bg-accent-orange/12 px-2.5 py-1.5 text-meta text-text" data-pro-focus-banner>
      <Crosshair className="h-3.5 w-3.5 shrink-0 text-accent-orange" aria-hidden />
      <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => open(true)} title="Change focus">
        Focus: {names.join(', ') || 'nothing'}
      </button>
      <button type="button" aria-label="Clear focus" className="rounded-control p-0.5 text-text-secondary hover:bg-bg-hover hover:text-text" onClick={() => setFocus(null)}>
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

/** The focus picker: categories and top-level projects. Drawn once in AppShell. */
export function FocusPickerHost() {
  const isOpen = useProUiStore((s) => s.focusPickerOpen)
  const setOpen = useProUiStore((s) => s.setFocusPickerOpen)
  const pro = usePro()
  if (!isOpen || !pro.layer('availability')) return null
  return <FocusPicker onClose={() => setOpen(false)} />
}

function FocusPicker({ onClose }: { onClose: () => void }) {
  const { focus, setFocus } = useFocus()
  const { categories } = useProjectCategories()
  const { data: projects } = useProjects()
  const { data: config } = useAppConfig()
  const inboxId = config?.inbox_project_id ?? 0
  const chosenCategories = useRef(new Set(focus?.categories ?? []))
  const chosenProjects = useRef(new Set(focus?.projects ?? []))
  const topLevel = (projects?.flat ?? []).filter((project) => !project.parent_project_id && project.id !== inboxId)

  const apply = () => {
    const next = { categories: [...chosenCategories.current], projects: [...chosenProjects.current] }
    setFocus(next.categories.length || next.projects.length ? next : null)
    onClose()
  }

  return (
    <Dialog open label="Focus" onClose={onClose} className="w-[420px] p-5">
      <h2 className="mb-1 text-card-title text-text">Focus</h2>
      <p className="mb-4 text-meta text-text-secondary">Show only these on this device. The Inbox always stays.</p>
      <div className="max-h-[50vh] space-y-4 overflow-y-auto">
        {categories.length > 0 && (
          <section>
            <h3 className="mb-1 text-group text-text-secondary">Categories</h3>
            {categories.map((category) => (
              <label key={category.id} className="flex cursor-pointer items-center gap-2 py-1">
                <Checkbox
                  defaultChecked={chosenCategories.current.has(category.id)}
                  onChange={(event) => (event.target.checked ? chosenCategories.current.add(category.id) : chosenCategories.current.delete(category.id))}
                />
                <span className="text-task-title text-text">{category.name}</span>
              </label>
            ))}
          </section>
        )}
        <section>
          <h3 className="mb-1 text-group text-text-secondary">Projects</h3>
          {topLevel.map((project) => (
            <label key={project.id} className="flex cursor-pointer items-center gap-2 py-1">
              <Checkbox
                defaultChecked={chosenProjects.current.has(project.id)}
                onChange={(event) => (event.target.checked ? chosenProjects.current.add(project.id) : chosenProjects.current.delete(project.id))}
              />
              <span className="text-task-title text-text">{project.title}</span>
            </label>
          ))}
        </section>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        {focus && (
          <button type="button" className="mr-auto rounded-control px-3 py-1.5 text-meta text-text-secondary hover:bg-bg-hover" onClick={() => { setFocus(null); onClose() }}>
            Clear focus
          </button>
        )}
        <button type="button" className="rounded-control px-3 py-1.5 text-meta text-text hover:bg-bg-hover" onClick={onClose}>Cancel</button>
        <button type="button" className="rounded-control bg-accent-fill px-3 py-1.5 text-meta font-medium text-on-accent" onClick={apply}>Focus</button>
      </div>
    </Dialog>
  )
}
