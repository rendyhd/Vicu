import { cn } from '@/lib/cn'

interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  /** Names the switch when it is not inside a <label> that already does. */
  'aria-label'?: string
  className?: string
}

/**
 * The app's switch for a setting that turns a whole feature on or off. Inside a <label> the label
 * text is its name and a click on the text toggles it. Under reduced motion the knob jumps (the
 * base layer limits transitions to colour and opacity).
 */
export function Switch({ checked, onCheckedChange, disabled, className, ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={rest['aria-label']}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-chip border border-transparent transition-colors duration-fade-fast disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-accent-fill' : 'bg-control-ring/50',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-chip bg-on-accent shadow transition-transform duration-fade-fast ease-standard',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
