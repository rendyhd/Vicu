import { cn } from '@/lib/cn'

interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: string
  /** One line under the title in text.secondary (Today's full date, a count, what the page is). */
  subtitle?: React.ReactNode
  /** The smart list icon (SmartListIcon) shown before the title. */
  icon?: React.ReactNode
  /** Buttons at the right edge, level with the title. */
  actions?: React.ReactNode
  /**
   * The header scrolls inside the view's scroll area (Settings) instead of sitting above it, so it
   * does not need to keep the scrollbar's width clear.
   */
  inScroll?: boolean
}

/** The one page header: title (page-title role), optional subtitle, actions on the right. */
export function PageHeader({ title, subtitle, icon, actions, inScroll, className, ...rest }: PageHeaderProps) {
  return (
    // The outer band spans the content region; the column inside is the same reading column as the list.
    <div className={cn('shrink-0', !inScroll && 'pr-[var(--scrollbar-size)]', className)} {...rest}>
      <div className="mx-auto flex w-full max-w-reading items-start justify-between gap-3 px-6 pb-3 pt-6">
        <div className="flex min-w-0 items-start gap-2.5">
          {icon && <span className="flex h-8 shrink-0 items-center">{icon}</span>}
          <div className="min-w-0">
            <h1 className="text-page-title leading-8 text-[var(--text-primary)]">{title}</h1>
            {subtitle && <p className="mt-0.5 text-meta text-[var(--text-secondary)]">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}
