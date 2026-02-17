import { cn } from '@/lib/cn'

interface ContentAreaProps {
  children: React.ReactNode
  className?: string
}

export function ContentArea({ children, className }: ContentAreaProps) {
  return (
    <div className={cn('flex flex-1 flex-col overflow-hidden bg-[var(--bg-primary)]', className)}>
      {children}
    </div>
  )
}
