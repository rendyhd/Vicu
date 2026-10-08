import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { SmartListIcon } from '@/components/shared/SmartListIcon'
import type { SmartListId } from '@/lib/smart-list-identity'

interface EmptyStateProps {
  /** Used when the list has no identity of its own. */
  icon: LucideIcon
  /** A smart list: its identity icon and colour replace `icon`. */
  identity?: SmartListId
  title: string
  subtitle?: string
  /** What the person can do about it (a Button), wherever adding is possible. */
  action?: React.ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, identity, title, subtitle, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center', className)}>
      {identity ? (
        <SmartListIcon list={identity} className="h-10 w-10" strokeWidth={1.5} />
      ) : (
        <Icon aria-hidden className="h-10 w-10 text-[var(--text-secondary)] opacity-40" strokeWidth={1.5} />
      )}
      <div className="space-y-1">
        <p className="text-card-title text-[var(--text-primary)]">{title}</p>
        {subtitle && <p className="text-meta text-[var(--text-secondary)]">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
