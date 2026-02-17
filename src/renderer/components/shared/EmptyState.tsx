import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  subtitle?: string
  className?: string
}

export function EmptyState({ icon: Icon, title, subtitle, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-1 flex-col items-center justify-center gap-3 py-16', className)}>
      <Icon className="h-10 w-10 text-[var(--text-secondary)] opacity-40" strokeWidth={1.5} />
      <p className="text-sm font-medium text-[var(--text-secondary)]">{title}</p>
      {subtitle && (
        <p className="text-xs text-[var(--text-secondary)] opacity-60">{subtitle}</p>
      )}
    </div>
  )
}
