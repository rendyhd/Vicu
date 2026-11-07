import { useTaskTemplates, useTemplateActions } from '@/hooks/use-task-templates'
import { useAppConfig } from '@/hooks/use-app-config'
import { useTemplateEditStore } from '@/stores/template-edit-store'
import { Dialog } from '../overlay/Dialog'
import { NewTaskComposer } from './NewTaskComposer'

/** Edit template (section 18.3): the new task row, holding the template, wherever Edit was chosen. */
export function TemplateEditHost() {
  const editingId = useTemplateEditStore((state) => state.editingId)
  const close = useTemplateEditStore((state) => state.close)
  const templates = useTaskTemplates()
  const { write } = useTemplateActions()
  const { data: appConfig } = useAppConfig()
  const template = templates.find((entry) => entry.id === editingId)
  if (!template) return null
  return (
    <Dialog open onClose={close} label="Edit template" className="w-[560px] max-w-[92vw]">
      <div className="px-4 pb-1 pt-3 text-sm font-medium text-[var(--text-primary)]">Edit template</div>
      <NewTaskComposer
        key={template.id}
        projectId={template.project_id ?? appConfig?.inbox_project_id ?? 0}
        template={template}
        onSaveTemplate={(edited) => {
          void write(template.id, edited).then((saved) => { if (saved) close() })
        }}
        onCancel={close}
        className="border-b-0"
      />
    </Dialog>
  )
}
