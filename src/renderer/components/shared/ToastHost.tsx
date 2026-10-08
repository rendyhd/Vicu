import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useToastStore } from '@/stores/toast-store'

/** Transient messages in the bottom-right corner: failed changes, "saved offline" notes. */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  // The live region is always mounted so screen readers pick up the first toast added to it.
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex items-start gap-2 rounded-md border bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] shadow-lg',
            t.kind === 'error' ? 'border-danger/60' : 'border-[var(--border-color)]',
          )}
        >
          <span
            className={cn(
              'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
              t.kind === 'error' ? 'bg-danger' : 'bg-[var(--accent-blue)]',
            )}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 break-words">{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="shrink-0 rounded p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )
}
