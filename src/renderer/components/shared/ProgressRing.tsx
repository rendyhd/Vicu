import { cn } from '@/lib/cn'
import { progressLabel, type ProjectProgress } from '@/lib/project-progress'

const SIZE = 14
const STROKE = 2
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

interface ProgressRingProps {
  progress: ProjectProgress
  /** The colour of the filled arc; the track is always the border colour. */
  color?: string
  className?: string
}

/**
 * A small ring that fills clockwise from the top as a project's tasks get done. A finished project
 * is a full ring. The colour never carries the meaning alone: the label reads "3 of 8 done".
 */
export function ProgressRing({ progress, color, className }: ProgressRingProps) {
  const dash = CIRCUMFERENCE * Math.min(1, Math.max(0, progress.fraction))
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={progressLabel(progress)}
      data-progress-ring={`${progress.done}/${progress.total}`}
      className={cn('shrink-0', className)}
      fill="none"
    >
      <title>{progressLabel(progress)}</title>
      <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} stroke="var(--border-color)" strokeWidth={STROKE} />
      {dash > 0 && (
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke={color || 'var(--text-secondary)'}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      )}
    </svg>
  )
}
