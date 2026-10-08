import { useId } from 'react'
import { cn } from '@/lib/cn'
import { Dialog } from '@/components/overlay/Dialog'

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
  /** Where focus goes on close when the dialog was opened from a menu item (see Dialog). */
  returnFocusTo?: HTMLElement | null
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
  returnFocusTo,
}: ConfirmDialogProps) {
  const messageId = useId()

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      role="alertdialog"
      label={`Confirm ${confirmLabel.toLowerCase()}`}
      describedBy={messageId}
      returnFocusTo={returnFocusTo}
      className="w-[calc(100%-2rem)] max-w-sm"
    >
      <div className="p-5">
        <p id={messageId} className="mb-4 whitespace-pre-line text-sm text-[var(--text-primary)]">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            data-autofocus
            type="button"
            onClick={onCancel}
            className={cn(
              'rounded-control border border-[var(--border-color)] px-4 py-1.5 text-sm font-medium',
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
                'rounded-control px-4 py-1.5 text-sm font-medium transition-colors',
                secondaryDestructive
                  ? 'bg-danger text-on-accent dark:text-bg-page hover:bg-danger/90'
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
              'rounded-control px-4 py-1.5 text-sm font-medium',
              destructive
                ? 'bg-danger text-on-accent dark:text-bg-page transition-colors hover:bg-danger/90'
                : 'bg-accent-fill text-on-accent transition-colors hover:bg-accent-fill/90'
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
