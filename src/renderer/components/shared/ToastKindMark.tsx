import { CheckCircle2, Info, TriangleAlert } from 'lucide-react'
import type { ToastKind } from '@/stores/toast-store'
import { TOAST_KIND_LABEL } from '@/stores/toast-store'
import { cn } from '@/lib/cn'

const ICONS = { error: TriangleAlert, success: CheckCircle2, info: Info } as const
const COLOURS: Record<ToastKind, string> = {
  error: 'text-danger',
  success: 'text-status-done',
  info: 'text-[var(--accent-blue)]',
}

/**
 * The kind of a toast as a shape, not only a colour: a warning triangle, a check, an "i". The icon
 * draws in currentColor, so it stays visible in forced-colours mode, and the wrapper names the kind
 * for screen readers ("Error", then the message).
 */
export function ToastKindMark({ kind }: { kind: ToastKind }) {
  const Icon = ICONS[kind]
  return (
    <span role="img" aria-label={TOAST_KIND_LABEL[kind]} data-toast-icon={kind} className={cn('flex h-6 shrink-0 items-center', COLOURS[kind])}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  )
}
