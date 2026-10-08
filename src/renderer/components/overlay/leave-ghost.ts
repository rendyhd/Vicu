/**
 * Leaving animation for the popovers and tooltips (card 4.1).
 *
 * The primitives are rendered only while they are open, so closing one unmounts it; a CSS
 * transition on the popover itself (`transition-behavior: allow-discrete`) would be cut off by the
 * unmount. Instead the primitive calls `leaveAsGhost` as it goes: a static, inert copy takes its
 * place and `.vicu-popover-leaving` (assets/index.css) fades it out, then it removes itself. The
 * copy is not a popover and has no roles, ids or tab stops, so nothing queries or focuses it.
 */

/** How long to wait for the animation before removing the copy anyway. */
const FALLBACK_MS = 600

/** Whether the element is an open popover that has been placed (a strict-mode remount never was). */
export function isLeavable(el: HTMLElement): boolean {
  if (!el.isConnected || el.dataset.placement === undefined) return false
  try {
    return el.matches(':popover-open')
  } catch {
    return false
  }
}

/** The element the copy goes into: the open modal dialog the popover is inside, else the body. */
function ghostParent(el: HTMLElement): HTMLElement {
  const dialog = el.closest('dialog')
  return dialog instanceof HTMLElement && dialog.open ? dialog : document.body
}

/** Replaces `el`, about to be removed, with a fading copy at the same place. */
export function leaveAsGhost(el: HTMLElement): void {
  if (typeof document === 'undefined' || !isLeavable(el)) return
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return

  const ghost = el.cloneNode(true) as HTMLElement
  ghost.removeAttribute('popover')
  // Nested popovers (an open picker inside a menu) leave on their own.
  ghost.querySelectorAll('[popover]').forEach((nested) => nested.remove())
  for (const node of [ghost, ...Array.from(ghost.querySelectorAll<HTMLElement>('[id], [role], [tabindex], [aria-label]'))]) {
    node.removeAttribute('id')
    node.removeAttribute('role')
    node.removeAttribute('tabindex')
    node.removeAttribute('aria-label')
  }
  ghost.classList.remove('vicu-popover', 'vicu-tooltip')
  ghost.classList.add('vicu-popover-leaving')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.setAttribute('inert', '')
  ghost.dataset.leaving = ''

  const parent = ghostParent(el)
  parent.appendChild(ghost)
  ghost.scrollTop = el.scrollTop

  const remove = () => ghost.remove()
  ghost.addEventListener('animationend', (event) => event.target === ghost && remove())
  window.setTimeout(remove, FALLBACK_MS)
}
