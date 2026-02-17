import { FolderOpen } from 'lucide-react'

interface ProjectDragOverlayProps {
  title: string
  hexColor?: string
}

export function ProjectDragOverlay({ title, hexColor }: ProjectDragOverlayProps) {
  return (
    <div className="flex h-7 items-center gap-2 rounded-lg border-2 border-[var(--accent-blue)] bg-[var(--bg-primary)] px-2 shadow-lg">
      <FolderOpen
        className="h-3.5 w-3.5 shrink-0"
        style={{ color: hexColor || 'var(--text-secondary)' }}
        strokeWidth={1.8}
      />
      <span className="truncate text-xs text-[var(--text-primary)]">{title}</span>
    </div>
  )
}
