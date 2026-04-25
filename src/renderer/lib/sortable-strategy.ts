import { verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { SortingStrategy } from '@dnd-kit/sortable'

// The default verticalListSortingStrategy treats activeIndex === -1 (foreign
// drag, e.g. dragging a task into a list of sections) as "displace every item
// up to overIndex by the dragged element's height." That makes the middle
// items in the list literally move out from under the pointer, so cross-list
// drops can only land on the last item. Returning null for foreign drags keeps
// items in place and lets normal drop targeting work.
export const verticalListSortingStrategyForeignSafe: SortingStrategy = (args) => {
  if (args.activeIndex === -1) return null
  return verticalListSortingStrategy(args)
}
