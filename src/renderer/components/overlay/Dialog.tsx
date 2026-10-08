import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface DialogProps {
  /** The dialog is in the document, and modal, only while this is true. */
  open: boolean
  /** Escape, a press on the backdrop, or the caller's own close control. The caller sets `open` false. */
  onClose: () => void
  /** Accessible name when the dialog has no visible title; otherwise point `labelledBy` at it. */
  label?: string
  /** Id of the element that titles the dialog. */
  labelledBy?: string
  /** Id of the element that holds the message (read after the name). */
  describedBy?: string
  /** `alertdialog` for a question that needs an answer (confirmations). */
  role?: 'dialog' | 'alertdialog'
  /** Selector of the element that takes focus on open. Default: the first `[data-autofocus]`, else the first control. */
  initialFocus?: string
  /**
   * Where focus goes when the dialog closes. By default the control that had focus when it opened,
   * but a dialog opened from a menu item would lose that (the menu closed and took the item with it):
   * pass the row or button the menu came from. Used only while it is still in the document.
   */
  returnFocusTo?: HTMLElement | null
  /** Width, padding and the like. Colours, border, radius and shadow come from the primitive. */
  className?: string
  children: ReactNode
}

/**
 * A modal dialog on the platform's own `<dialog>` and `showModal()`: it sits in the top layer
 * above everything, the rest of the page is inert (so focus cannot leave it), Escape closes it and
 * focus returns to the control that opened it. Render it with `open` and put the content inside.
 */
export function Dialog({ open, ...props }: DialogProps) {
  if (!open) return null
  return <OpenDialog {...props} />
}

function OpenDialog({
  onClose,
  label,
  labelledBy,
  describedBy,
  role = 'dialog',
  initialFocus = '[data-autofocus]',
  returnFocusTo,
  className,
  children,
}: Omit<DialogProps, 'open'>) {
  const ref = useRef<HTMLDialogElement>(null)
  const pressedOn = useRef<EventTarget | null>(null)
  const focusRef = useRef(initialFocus)
  focusRef.current = initialFocus
  const returnRef = useRef(returnFocusTo)
  returnRef.current = returnFocusTo

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const opener = document.activeElement
    if (!el.open) el.showModal()
    // showModal() focuses the first control; a dialog can name a better one (the safe button).
    el.querySelector<HTMLElement>(focusRef.current)?.focus({ preventScroll: true })
    return () => {
      if (el.open) el.close()
      // The caller's choice wins; the opener is the fallback (and the choice may have left the page).
      const explicit = returnRef.current
      const target = explicit && explicit.isConnected ? explicit : opener
      if (target instanceof HTMLElement && target.isConnected && target !== document.body) {
        target.focus({ preventScroll: true })
      }
    }
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    // Escape belongs to the dialog: the page behind it (collapse the card, clear the selection)
    // must not also react. The browser's cancel event below does the closing.
    if (event.key === 'Escape') event.stopPropagation()
  }

  return (
    <dialog
      ref={ref}
      role={role === 'alertdialog' ? 'alertdialog' : undefined}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      // A press that starts inside and ends on the backdrop (a text selection) is not a click on it.
      onMouseDown={(event) => {
        pressedOn.current = event.target
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressedOn.current === event.currentTarget) onClose()
        pressedOn.current = null
      }}
      className={cn(
        'm-auto max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-0 text-[var(--text-primary)] shadow-xl',
        'backdrop:bg-black/50',
        className,
      )}
    >
      {children}
    </dialog>
  )
}
