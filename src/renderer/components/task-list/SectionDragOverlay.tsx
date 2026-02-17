interface SectionDragOverlayProps {
  title: string
}

export function SectionDragOverlay({ title }: SectionDragOverlayProps) {
  return (
    <div className="flex h-9 items-center rounded-lg border-2 border-[var(--accent-blue)] bg-[var(--bg-primary)] px-4 shadow-lg">
      <span className="truncate text-[13px] font-bold text-[var(--text-primary)]">{title}</span>
    </div>
  )
}
