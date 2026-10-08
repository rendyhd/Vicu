import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useUndoCompletedTasks } from '@/hooks/use-completion-hold'
import { setCompletionUndoHandler } from '@/stores/completion-hold-store'
import { useAnnouncerStore } from '@/stores/announcer-store'
import { useToastStore } from '@/stores/toast-store'
import { ToastKindMark } from './ToastKindMark'
import type { Toast } from '@/stores/toast-store'

/** A toast that left the store stays here while it fades out; the animation end (or this limit) drops it. */
type Shown = Toast & { leaving: boolean }
/** A plain limit above the toast fade-out, for a toast whose animation never ends (reduced motion, hidden window). */
const LEAVE_LIMIT_MS = 600

/** Transient messages in the bottom-right corner: failed changes, "saved offline" notes, "Completed, Undo". */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)
  const [shown, setShown] = useState<Shown[]>([])

  // Toasts that left the store keep rendering, marked as leaving, until their fade ends.
  useEffect(() => {
    setShown((previous) => {
      const live = new Set(toasts.map((t) => t.id))
      const leaving = previous.filter((t) => !live.has(t.id)).map((t) => ({ ...t, leaving: true }))
      return [...toasts.map((t) => ({ ...t, leaving: false })), ...leaving]
    })
  }, [toasts])

  // Undo on the completion toast reopens the tasks it covers (needs the reopen mutation).
  const undoCompleted = useUndoCompletedTasks()
  useEffect(() => setCompletionUndoHandler(undoCompleted), [undoCompleted])

  const drop = (id: number) => setShown((previous) => previous.filter((t) => t.id !== id))

  // The container is the one live region of the toasts, always mounted so the first message is picked up; a
  // toast inside it has no live role of its own (status or alert nested in it would be read twice, an error
  // included: it is polite like the rest, and its red mark and the name of its kind say what it is).
  return (
    <>
      <Announcer />
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
        aria-live="polite"
      >
        {shown.map((t) => (
          <ToastItem key={t.id} toast={t} onGone={() => drop(t.id)} />
        ))}
      </div>
    </>
  )
}

/** "Completed Buy milk" for screen readers, the moment a task is completed. */
function Announcer() {
  const message = useAnnouncerStore((s) => s.message)
  const nonce = useAnnouncerStore((s) => s.nonce)
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-announcer="">
      {message && <span key={nonce}>{message}</span>}
    </div>
  )
}

function ToastItem({ toast, onGone }: { toast: Shown; onGone: () => void }) {
  const dismiss = useToastStore((s) => s.dismiss)
  const engage = useToastStore((s) => s.engage)
  const pointer = useRef(false)
  const focus = useRef(false)
  const engaged = useRef(false)
  const id = toast.id

  // One engagement signal from the pointer and keyboard focus together: the clock waits while either is on the toast.
  const update = () => {
    const now = pointer.current || focus.current
    if (now === engaged.current) return
    engaged.current = now
    engage(id, now)
  }

  useEffect(() => {
    if (!toast.leaving) return
    const timer = setTimeout(onGone, LEAVE_LIMIT_MS)
    return () => clearTimeout(timer)
  }, [toast.leaving, onGone])

  // A toast that is removed while engaged never sees the pointer leave.
  useEffect(
    () => () => {
      if (engaged.current) engage(id, false)
    },
    [id, engage]
  )

  const isError = toast.kind === 'error'
  return (
    <div
      data-toast-kind={toast.kind}
      onAnimationEnd={() => {
        if (toast.leaving) onGone()
      }}
      onPointerEnter={() => {
        pointer.current = true
        update()
      }}
      onPointerLeave={() => {
        pointer.current = false
        update()
      }}
      onFocus={(e) => {
        // Keyboard focus only: a mouse click leaves focus on the button and must not hold the toast.
        if (e.target.matches(':focus-visible')) {
          focus.current = true
          update()
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          focus.current = false
          update()
        }
      }}
      className={cn(
        'flex items-start gap-2 rounded-popover border bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] shadow-lg',
        toast.leaving ? 'pointer-events-none vicu-toast-out' : 'pointer-events-auto vicu-toast-in',
        isError ? 'border-danger/60' : 'border-[var(--border-color)]'
      )}
    >
      <ToastKindMark kind={toast.kind} />
      <span className="min-w-0 flex-1 break-words">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onAction()
            dismiss(id)
          }}
          className="shrink-0 rounded-control px-2 py-1 font-medium text-accent hover:bg-[var(--bg-hover)]"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismiss(id)}
        className="shrink-0 rounded-control p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        aria-label="Dismiss"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
