import { cn } from '@/lib/cn'

const priorityColors: Record<number, string> = {
  1: 'bg-accent-blue',
  2: 'bg-accent-yellow',
  3: 'bg-accent-orange',
  4: 'bg-accent-red',
}

interface PriorityDotProps {
  priority: number
  className?: string
}

export function PriorityDot({ priority, className }: PriorityDotProps) {
  if (!priority || !priorityColors[priority]) return null

  return (
    <span
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', priorityColors[priority], className)}
      title={`Priority ${priority}`}
    />
  )
}
