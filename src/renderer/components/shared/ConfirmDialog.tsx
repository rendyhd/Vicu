import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'

interface ConfirmDialogProps {
  open: boolean
  message: string
  onConfirm: () => void
  onCancel: () => void
  confirmLabel?: string
  destructive?: boolean
  secondaryLabel?: string
  onSecondary?: () => void
  secondaryDestructive?: boolean
}

export function ConfirmDialog({
  open,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Delete',
  destructive = true,
  secondaryLabel,
  onSecondary,
  secondaryDestructive = false,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => document.removeEventListener('keydown', handleKey, true)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-4 text-sm text-[var(--text-primary)]">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className={cn(
              'rounded-md border border-[var(--border-color)] px-4 py-1.5 text-sm font-medium',
              'text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]'
            )}
          >
            Cancel
          </button>
          {secondaryLabel && onSecondary && (
            <button
              type="button"
              onClick={onSecondary}
              className={cn(
                'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                secondaryDestructive
                  ? 'bg-accent-red text-white hover:bg-accent-red/90'
                  : 'border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              )}
            >
              {secondaryLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium',
              destructive
                ? 'bg-accent-red text-white transition-colors hover:bg-accent-red/90'
                : 'bg-accent-blue text-white transition-colors hover:bg-accent-blue/90'
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
