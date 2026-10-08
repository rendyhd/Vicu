import {
  createContext,
  forwardRef,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react'
import type { Placement } from '@floating-ui/dom'
import { Check, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Popover, type PopoverCloseReason } from './Popover'
import { OPTION_SELECTOR } from './popover-logic'

interface MenuContextValue {
  /** Closes the menu (focus goes back to where it was). */
  close: () => void
}

/** Focus starts on the first item, not on the checked radio the popover would otherwise prefer. */
const FIRST_ITEM = '[role^="menuitem"]:not([disabled])'

const MenuContext = createContext<MenuContextValue>({ close: () => undefined })

export interface MenuProps {
  /** The button that opened it: the menu sits next to it. Give this or `anchorPoint`. */
  anchorRef?: RefObject<HTMLElement | null>
  /** Where it was opened without a button (a context menu): the menu opens at this point. */
  anchorPoint?: { x: number; y: number }
  /** Accessible name. */
  label: string
  /** Called when the menu closes: after a choice (no reason) or when the browser dismissed it. */
  onClose: (reason?: PopoverCloseReason) => void
  placement?: Placement
  className?: string
  children: ReactNode
}

/**
 * A menu on the Popover primitive: `role="menu"` with `menuitem`, `menuitemradio` and separators
 * inside. Arrow keys, Home and End move between items, typing the start of a name jumps to it,
 * Right opens a submenu or picker, Left and Escape close the layer they are in, Tab closes the
 * menu, Enter and Space choose. Focus goes to the first item on open and back to where it was on
 * close.
 */
export function Menu({ anchorRef, anchorPoint, label, onClose, placement, className, children }: MenuProps) {
  const pointRef = useRef<HTMLSpanElement>(null)
  // A menu opened at a point has no button to return to: it gives focus back to what had it.
  const [opener] = useState<Element | null>(() => (typeof document === 'undefined' ? null : document.activeElement))

  // When the menu goes away (a choice, Escape, a picker inside it) focus goes back to what had it,
  // unless it was already moved somewhere else on purpose (a dialog the choice opened).
  useLayoutEffect(() => {
    if (!anchorPoint) return
    return () => {
      const active = document.activeElement
      const lost = !active || active === document.body || !!active.closest('[role="menu"]')
      if (lost && opener instanceof HTMLElement && opener.isConnected && opener !== document.body) {
        opener.focus({ preventScroll: true })
      }
    }
    // The point is fixed for the life of the menu; the opener is read once.
  }, [])

  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const context = useMemo<MenuContextValue>(() => ({ close: () => closeRef.current() }), [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    const menu = event.currentTarget
    const insideNested = target.closest('[popover]') !== menu

    // Right on an item that opens a picker or a submenu opens it.
    if (event.key === 'ArrowRight' && !insideNested && target.matches(OPTION_SELECTOR) && target.hasAttribute('aria-haspopup')) {
      event.preventDefault()
      if (target.getAttribute('aria-expanded') !== 'true') target.click()
      return
    }
    // Left inside a nested list or menu closes it and returns to the item that opened it. A nested
    // dialog (a calendar, a search field) keeps its own arrow keys.
    if (event.key === 'ArrowLeft' && insideNested && target.matches(OPTION_SELECTOR)) {
      const nested = target.closest<HTMLElement>('[popover]')
      if (nested && nested.getAttribute('role') !== 'dialog') {
        event.preventDefault()
        event.stopPropagation()
        nested.hidePopover()
      }
    }
  }

  const popover = (
    <Popover
      anchorRef={(anchorPoint ? pointRef : anchorRef) as RefObject<HTMLElement | null>}
      onClose={onClose}
      label={label}
      role="menu"
      initialFocus={FIRST_ITEM}
      placement={placement ?? 'bottom-start'}
      onKeyDown={onKeyDown}
      className={cn('min-w-[200px] py-1', className)}
    >
      <MenuContext.Provider value={context}>{children}</MenuContext.Provider>
    </Popover>
  )

  if (!anchorPoint) return popover
  return (
    <>
      {/* The invisible anchor the menu is placed against; it comes first so its ref is set. */}
      <span
        ref={pointRef}
        aria-hidden="true"
        className="pointer-events-none fixed h-0 w-0"
        style={{ left: anchorPoint.x, top: anchorPoint.y }}
      />
      {popover}
    </>
  )
}

const itemBase =
  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-primary)] ' +
  'hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)] disabled:opacity-50'

interface MenuItemShared {
  /** Leading icon. Every item has the icon column, so labels line up; a missing icon leaves it empty. */
  icon?: ReactNode
  /** Called when the item is chosen (click, Enter or Space). */
  onSelect?: () => void
  /** Leave the menu open after the choice (items that open a picker). */
  keepOpen?: boolean
  danger?: boolean
  disabled?: boolean
  /** The item opens a picker or a submenu of this kind. */
  popup?: 'dialog' | 'listbox' | 'menu'
  expanded?: boolean
  children: ReactNode
}

export interface MenuItemProps extends MenuItemShared {
  /** A shortcut that really exists, shown at the right edge (for example "Ctrl+K"). */
  shortcut?: string
}

export interface MenuRadioItemProps extends MenuItemShared {
  /** Whether this is the current choice of its group. */
  checked: boolean
}

function IconCell({ icon, danger }: { icon?: ReactNode; danger?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5',
        danger ? 'text-danger' : 'text-[var(--text-secondary)]',
      )}
    >
      {icon}
    </span>
  )
}

/** The text a typeahead search matches (plain text children only; others fall back to the DOM text). */
const labelOf = (children: ReactNode) => (typeof children === 'string' ? children : undefined)

function useChoose({ onSelect, keepOpen }: Pick<MenuItemShared, 'onSelect' | 'keepOpen'>) {
  const { close } = useContext(MenuContext)
  return () => {
    onSelect?.()
    if (!keepOpen) close()
  }
}

export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(function MenuItem(
  { icon, shortcut, onSelect, keepOpen, danger, disabled, popup, expanded, children },
  ref: Ref<HTMLButtonElement>,
) {
  const choose = useChoose({ onSelect, keepOpen: keepOpen ?? popup != null })
  return (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={disabled}
      data-typeahead={labelOf(children)}
      aria-haspopup={popup}
      aria-expanded={popup ? (expanded ?? false) : undefined}
      onClick={choose}
      className={cn(itemBase, danger && 'text-danger hover:bg-danger/10 focus-visible:bg-danger/10')}
    >
      <IconCell icon={icon} danger={danger} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && <kbd className="shrink-0 font-sans text-caption text-[var(--text-secondary)]">{shortcut}</kbd>}
      {popup && <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" />}
    </button>
  )
})

/** One of a group of exclusive choices; the current one is checked. */
export const MenuRadioItem = forwardRef<HTMLButtonElement, MenuRadioItemProps>(function MenuRadioItem(
  { icon, checked, onSelect, keepOpen, danger, disabled, children },
  ref: Ref<HTMLButtonElement>,
) {
  const choose = useChoose({ onSelect, keepOpen })
  return (
    <button
      ref={ref}
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={-1}
      disabled={disabled}
      data-typeahead={labelOf(children)}
      onClick={choose}
      className={cn(itemBase, danger && 'text-danger hover:bg-danger/10 focus-visible:bg-danger/10')}
    >
      <IconCell icon={icon} danger={danger} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {checked && <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--accent-blue)]" />}
    </button>
  )
})

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-[var(--border-color)]" />
}

/** A heading above the items. Decorative: the menu's own name already says the same. */
export function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className="px-3 py-1 text-caption font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
    >
      {children}
    </div>
  )
}
