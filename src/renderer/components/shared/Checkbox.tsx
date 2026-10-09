import { forwardRef } from 'react'
import { cn } from '@/lib/cn'

type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>

/**
 * The app's checkbox for forms: a native checkbox (role, state and keyboard come with it) drawn like
 * the task checkbox, ring control.ring, checked accent.fill with an on.accent check. Put it inside a
 * <label> so the whole row is the target.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ className, ...rest }, ref) {
  return (
    <span className={cn('relative inline-flex h-[18px] w-[18px] shrink-0', className)}>
      <input
        ref={ref}
        type="checkbox"
        className="peer h-full w-full cursor-pointer appearance-none rounded-control border border-control-ring bg-transparent transition-colors duration-fade-fast hover:border-accent-fill checked:border-accent-fill checked:bg-accent-fill disabled:cursor-not-allowed disabled:opacity-50"
        {...rest}
      />
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-on-accent opacity-0 transition-opacity duration-fade-fast peer-checked:opacity-100"
        viewBox="0 0 12 12"
        fill="none"
      >
        <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
})
