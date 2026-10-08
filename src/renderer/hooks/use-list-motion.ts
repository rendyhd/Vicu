import { useEffect } from 'react'
import type { RefObject } from 'react'
import { readReducedMotion } from '@/hooks/use-reduced-motion'
import { diffRows, type RowBox } from '@/lib/list-motion'
import { motionStagger, playMoveFrom } from '@/lib/motion'
import { playRowClose, playRowOpen } from '@/lib/row-close'

// Motion for the rows of a list view (card 4.8), watched from the scroll area that holds them:
//   - a row that is new opens from no height, a row that is gone closes (playRowOpen / playRowClose,
//     the one mechanism the completion close also uses);
//   - rows that moved because the list was reordered (an undo, a refetch, a task moved from
//     elsewhere) play from their old place with move.expressive, staggered (at most 5);
//   - rows below a card that opens or closes play with the move spring, so they do not jump.
// A drag is left to dnd-kit and the drop animation. Nothing animates for a first load, a change of
// view (too many rows added or removed at once) or under reduced motion (fades only).

/** More rows than this and the list is not tracked: measuring them all costs more than it is worth. */
const MAX_ROWS = 200

/** Our translate animations, so a later pass can take them off before it measures. */
const MOVES = new WeakSet<Animation>()

interface Place {
  parent: Element
  next: Node | null
  prev: Node | null
}

interface Snapshot {
  boxes: Map<number, RowBox>
  els: Map<number, HTMLElement>
  places: Map<number, Place>
}

const rowsOf = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-task-id]')).filter((el) => !el.hasAttribute('data-row-closing'))

function measure(root: HTMLElement, rows: HTMLElement[]): Map<number, RowBox> {
  const base = root.getBoundingClientRect()
  const boxes = new Map<number, RowBox>()
  for (const el of rows) {
    const r = el.getBoundingClientRect()
    boxes.set(Number(el.getAttribute('data-task-id')), {
      top: r.top - base.top + root.scrollTop,
      left: r.left - base.left + root.scrollLeft,
      height: r.height,
    })
  }
  return boxes
}

function snapshot(boxes: Map<number, RowBox>, rows: HTMLElement[]): Snapshot {
  const els = new Map<number, HTMLElement>()
  const places = new Map<number, Place>()
  for (const el of rows) {
    const id = Number(el.getAttribute('data-task-id'))
    els.set(id, el)
    if (el.parentElement) places.set(id, { parent: el.parentElement, next: el.nextSibling, prev: el.previousSibling })
  }
  return { boxes, els, places }
}

/** Puts a removed row element back where it was, as a copy that cannot be reached; false when there is no place for it. */
function reinsert(el: HTMLElement, place: Place): boolean {
  const { parent, next, prev } = place
  if (!parent.isConnected) return false
  if (next === null) parent.appendChild(el)
  else if (next.parentNode === parent) parent.insertBefore(el, next)
  else if (prev && prev.parentNode === parent) parent.insertBefore(el, prev.nextSibling)
  else return false
  return true
}

export function useListMotion(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof MutationObserver === 'undefined') return

    let previous: Snapshot | null = null
    // Open and close animations running: a layout measured meanwhile is neither the old nor the new one.
    let busy = 0
    let recordTimer: ReturnType<typeof setTimeout> | undefined

    const finishOne = () => {
      busy--
      if (busy === 0) pass()
    }

    const pass = () => {
      if (busy > 0) return
      const rows = rowsOf(root)
      // Rows with an inline transform are being sorted by dnd-kit; measure again once it is done.
      if (rows.length === 0 || rows.length > MAX_ROWS || rows.some((el) => el.style.transform)) {
        previous = null
        if (rows.length > 0 && rows.length <= MAX_ROWS) {
          clearTimeout(recordTimer)
          recordTimer = setTimeout(pass, 300)
        }
        return
      }

      // Where each row is drawn now, then where it is laid out (our own translations taken off).
      const drawn = measure(root, rows)
      let cancelled = false
      for (const el of rows) {
        for (const animation of el.getAnimations()) {
          if (MOVES.has(animation)) {
            animation.cancel()
            cancelled = true
          }
        }
      }
      const layout = cancelled ? measure(root, rows) : drawn
      const inflight = new Map<number, { x: number; y: number }>()
      if (cancelled) {
        for (const [id, box] of layout) {
          const was = drawn.get(id)
          if (was && (Math.abs(was.top - box.top) > 0.01 || Math.abs(was.left - box.left) > 0.01)) {
            inflight.set(id, { x: was.left - box.left, y: was.top - box.top })
          }
        }
      }

      const now = snapshot(layout, rows)
      const before = previous
      previous = now
      if (!before) return

      const restructured = new Set<number>()
      for (const [id, el] of now.els) if (before.els.has(id) && before.els.get(id) !== el) restructured.add(id)
      const diff = diffRows(before.boxes, layout, inflight, restructured)
      const reduced = readReducedMotion()

      for (const id of diff.added) {
        const el = now.els.get(id)
        if (!el || typeof el.animate !== 'function') continue
        busy++
        const animation = playRowOpen(el, reduced)
        animation.finished.then(finishOne, finishOne)
      }
      for (const id of diff.removed) {
        const el = before.els.get(id)
        const place = before.places.get(id)
        // A completed row has already closed itself (use-completion-collapse).
        if (!el || !place || el.dataset.rowClosed !== undefined || typeof el.animate !== 'function') continue
        el.removeAttribute('data-task-id')
        el.setAttribute('data-row-closing', '')
        el.setAttribute('aria-hidden', 'true')
        el.setAttribute('inert', '')
        el.style.pointerEvents = 'none'
        if (!reinsert(el, place)) continue
        busy++
        const animation = playRowClose(el, reduced)
        const done = () => {
          el.remove()
          finishOne()
        }
        animation.finished.then(done, done)
      }
      // The rows around an opening or closing row follow its height; only moves are played here.
      const stagger = restructured.size === 0
      diff.moved.forEach((move, index) => {
        const el = now.els.get(move.id)
        if (!el) return
        const animation = playMoveFrom(el, move.dx, move.dy, stagger ? 'move-expressive' : 'move', {
          delay: stagger ? motionStagger(index) : 0,
        })
        if (animation) MOVES.add(animation)
      })
    }

    const observer = new MutationObserver((records) => {
      // Typing in an open card changes the DOM inside it all the time and moves no row.
      const insideCard = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest('.vicu-card')
      if (records.every((record) => insideCard(record.target))) return
      pass()
    })
    observer.observe(root, { childList: true, subtree: true })
    pass()

    return () => {
      observer.disconnect()
      clearTimeout(recordTimer)
    }
  }, [rootRef])
}
