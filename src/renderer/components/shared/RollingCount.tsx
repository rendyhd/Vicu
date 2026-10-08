import { useEffect, useState } from 'react'
import { rollDirection, type RollDirection } from '@/lib/roll'
import { cn } from '@/lib/cn'

interface RollingCountProps {
  value: number
  className?: string
}

interface Rolling {
  value: number
  leaving: { value: number; direction: RollDirection; id: number } | null
}

let rolls = 0

/** How long the old number stays (fade.base plus a little); the CSS animation is that long. */
const LEAVE_MS = 400

/**
 * A count that rolls when it changes (card 4.11a): the old number leaves and the new one comes in,
 * up when the count grew and down when it shrank, over fade.base. Reduced motion: a cross-fade.
 * It does not animate on first render. Screen readers get the current value only; the number that
 * is leaving is hidden from them.
 */
export function RollingCount({ value, className }: RollingCountProps) {
  const [state, setState] = useState<Rolling>({ value, leaving: null })

  // Derived while rendering, so the new number is in the same frame as the change.
  if (state.value !== value) {
    const direction = rollDirection(state.value, value)
    setState({ value, leaving: direction ? { value: state.value, direction, id: ++rolls } : null })
  }

  const leavingId = state.leaving?.id
  useEffect(() => {
    if (leavingId === undefined) return
    const timer = window.setTimeout(() => setState((s) => (s.leaving?.id === leavingId ? { ...s, leaving: null } : s)), LEAVE_MS)
    return () => window.clearTimeout(timer)
  }, [leavingId])

  const { leaving } = state
  return (
    <span className={cn('relative inline-flex overflow-hidden align-bottom tabular-nums', className)} data-rolling-count>
      <span key={leaving ? leaving.id : 'rest'} data-roll-in={leaving ? leaving.direction : undefined} className={leaving ? 'vicu-roll-in' : undefined}>
        {state.value}
      </span>
      {leaving && (
        <span aria-hidden="true" data-roll-out={leaving.direction} className="vicu-roll-out absolute inset-0">
          {leaving.value}
        </span>
      )}
    </span>
  )
}
