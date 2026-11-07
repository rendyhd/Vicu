import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { noteFoldHeight, shownNoteHeight } from './note-fold'

/**
 * Long notes stop at about half the window, with a fade and Show all, so the rest of the task card
 * stays in reach. Focus in the text opens them, so editing works straight away. A card starts folded
 * each time it opens, and short notes never fold.
 */
export function FoldedNotes({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState(0)
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight)

  useLayoutEffect(() => {
    const element = inner.current
    if (!element) return
    const measure = () => setFull(element.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    const onResize = () => setWindowHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const fold = noteFoldHeight(windowHeight)
  const shown = shownNoteHeight(full, fold, open)
  const folded = shown < full

  return (
    <>
      <div
        onFocusCapture={() => setOpen(true)}
        className={folded ? 'overflow-hidden' : undefined}
        style={
          folded
            ? {
                maxHeight: shown,
                maskImage: 'linear-gradient(to bottom, black calc(100% - 48px), transparent)',
              }
            : undefined
        }
      >
        <div ref={inner}>{children}</div>
      </div>
      {folded && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1 rounded-control text-caption font-medium text-[var(--accent-blue)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          Show all
        </button>
      )}
    </>
  )
}
