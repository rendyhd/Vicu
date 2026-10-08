import { forwardRef } from 'react'
import { cn } from '@/lib/cn'

// The three button styles of the design system: primary (one per surface, the action the surface is
// for), secondary (outlined) and quiet (text only). `danger` recolours a button for a destructive
// action; it is not a fourth style. Every button is at least 28 px high and takes the app focus ring.

export type ButtonVariant = 'primary' | 'secondary' | 'quiet'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  danger?: boolean
}

const BASE =
  'inline-flex min-h-7 shrink-0 items-center justify-center gap-1.5 rounded-control px-3.5 py-1 text-task-title font-medium transition-colors duration-fade-fast disabled:cursor-not-allowed disabled:opacity-50'

const VARIANTS: Record<ButtonVariant, { normal: string; danger: string }> = {
  primary: {
    normal: 'bg-accent-fill text-on-accent hover:bg-accent-fill/90',
    danger: 'bg-danger text-on-accent dark:text-bg-page hover:bg-danger/90',
  },
  secondary: {
    normal: 'border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
    danger: 'border border-danger/30 text-danger hover:bg-danger/10',
  },
  quiet: {
    normal: 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
    danger: 'text-danger hover:bg-danger/10',
  },
}

export function buttonClasses(variant: ButtonVariant = 'secondary', danger = false, className?: string): string {
  return cn(BASE, danger ? VARIANTS[variant].danger : VARIANTS[variant].normal, className)
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', danger = false, type = 'button', className, ...rest },
  ref,
) {
  return <button ref={ref} type={type} className={buttonClasses(variant, danger, className)} {...rest} />
})
