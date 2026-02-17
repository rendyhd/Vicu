import { List } from 'lucide-react'

interface CustomListDragOverlayProps {
  name: string
}

export function CustomListDragOverlay({ name }: CustomListDragOverlayProps) {
  return (
    <div className="flex h-8 items-center gap-2.5 rounded-lg border-2 border-[var(--accent-blue)] bg-[var(--bg-primary)] px-2.5 shadow-lg">
      <List className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" strokeWidth={1.8} />
      <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">{name}</span>
    </div>
  )
}
