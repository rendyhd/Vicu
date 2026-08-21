/**
 * Global delete-confirmation bridge.
 *
 * The right-click context menu can't host its own confirm dialog — the menu
 * closes on outside-mousedown, which would unmount a child dialog before the
 * user answers. Instead a single `<GlobalConfirm>` (mounted in AppShell)
 * registers the real `useConfirmDelete().confirmDelete` here, so any code —
 * the menu, the keyboard handler, bulk actions — can `await confirmDelete(msg)`
 * and get the styled dialog that respects the `confirm_before_delete` setting.
 */
import type { ConfirmOptions } from '@/hooks/use-confirm-delete'

type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>

let confirmFn: ConfirmFn | null = null

export function registerConfirm(fn: ConfirmFn | null): void {
  confirmFn = fn
}

export function confirmDelete(message: string, options?: ConfirmOptions): Promise<boolean> {
  if (confirmFn) return confirmFn(message, options)
  // Defensive fallback if the global dialog isn't mounted yet.
  return Promise.resolve(window.confirm(message))
}
