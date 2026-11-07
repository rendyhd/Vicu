import { useRef, useState } from 'react'
import { ChevronDown, Pencil, Trash2 } from 'lucide-react'
import { useDateFormat } from '@/hooks/use-date-format'
import { useTaskTemplates, useTemplateActions } from '@/hooks/use-task-templates'
import { formatDateChip } from '@/lib/date-utils'
import { useTemplateEditStore } from '@/stores/template-edit-store'
import { toLocalDate } from '../../../shared/due-dates'
import { templateDueDate, type ListedTemplate } from '../../../shared/task-templates'
import { Menu, MenuItem } from '../overlay/Menu'
import { Popover } from '../overlay/Popover'

function TemplateRow({ template, onUse, onClose }: { template: ListedTemplate; onUse: () => void; onClose: () => void }) {
  const arrow = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const openEdit = useTemplateEditStore((state) => state.open)
  const { remove } = useTemplateActions()
  const dateFormat = useDateFormat()
  const dueDate = templateDueDate(template.due, toLocalDate(new Date()))
  const count = template.subtasks?.length ?? 0
  const details = [
    dueDate ? formatDateChip(new Date(dueDate), !template.due?.time, new Date(), dateFormat) : null,
    count ? `${count} subtask${count === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(', ')
  return (
    <div className="group flex items-center rounded-control hover:bg-[var(--bg-hover)] focus-within:bg-[var(--bg-hover)]">
      <button type="button" onClick={onUse} className="min-w-0 flex-1 rounded-control px-2 py-1.5 text-left">
        <div className="truncate text-sm text-[var(--text-primary)]">{template.title}</div>
        {details && <div className="truncate text-caption text-[var(--text-secondary)]">{details}</div>}
      </button>
      <button
        ref={arrow}
        type="button"
        aria-label={`Edit or remove ${template.title}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
        className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-[var(--text-secondary)] opacity-0 hover:text-[var(--text-primary)] focus:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
      >
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {menuOpen && (
        <Menu anchorRef={arrow} onClose={() => setMenuOpen(false)} label={template.title}>
          <MenuItem icon={<Pencil />} onSelect={() => { onClose(); openEdit(template.id) }}>Edit</MenuItem>
          <MenuItem icon={<Trash2 />} onSelect={() => { void remove(template) }}>Remove</MenuItem>
        </Menu>
      )}
    </div>
  )
}

/** The account's templates (section 18.3): a click makes the task, the small arrow offers Edit and Remove. */
export function TemplatePickerPopover({ anchorRef, fallbackProjectId, onUsed, onClose }: {
  anchorRef: React.RefObject<HTMLButtonElement>
  fallbackProjectId: number
  onUsed: () => void
  onClose: () => void
}) {
  const templates = useTaskTemplates()
  const { make } = useTemplateActions()
  return (
    <Popover anchorRef={anchorRef} label="Templates" onClose={onClose} className="max-h-80 w-64 overflow-y-auto p-1">
      {templates.map((template) => (
        <TemplateRow
          key={template.id}
          template={template}
          onClose={onClose}
          onUse={() => {
            onUsed()
            void make(template, fallbackProjectId)
          }}
        />
      ))}
    </Popover>
  )
}
