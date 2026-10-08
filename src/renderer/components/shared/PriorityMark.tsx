import { cn } from '@/lib/cn'
import {
  PRIORITY_MARK_VIEWBOX,
  PRIORITY_SLOT_OPACITY,
  SQUARE_BANG_PATH,
  priorityBars,
  priorityMark,
  type PriorityRole,
} from '../../../shared/priority-mark-svg'

// The Tailwind role classes have to appear literally so the class scanner generates them.
const ROLE_CLASS: Record<PriorityRole, string> = {
  'priority.low': 'text-priority-low',
  'priority.medium': 'text-priority-medium',
  'priority.high': 'text-priority-high',
  'priority.urgent': 'text-priority-urgent',
}

interface PriorityMarkProps {
  priority: number
  className?: string
  /** Decorative (next to its own text name, as in the pickers): hidden from assistive technology. */
  decorative?: boolean
}

/** The priority mark: one to three bars, or a square with "!" for urgent. Nothing for priority 0. */
export function PriorityMark({ priority, className, decorative = false }: PriorityMarkProps) {
  const spec = priorityMark(priority)
  if (!spec) return null
  return (
    <svg
      width={14}
      height={14}
      viewBox={`0 0 ${PRIORITY_MARK_VIEWBOX} ${PRIORITY_MARK_VIEWBOX}`}
      fill="currentColor"
      className={cn('shrink-0', ROLE_CLASS[spec.role], className)}
      data-priority-mark={spec.kind}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': spec.name })}
    >
      {spec.kind === 'square-bang' ? (
        <path fillRule="evenodd" d={SQUARE_BANG_PATH} />
      ) : (
        priorityBars(spec.kind).map((bar) => (
          <rect
            key={bar.x}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            rx={1}
            fillOpacity={bar.on ? undefined : PRIORITY_SLOT_OPACITY}
          />
        ))
      )}
    </svg>
  )
}
