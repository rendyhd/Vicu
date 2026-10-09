import { cn } from '@/lib/cn'
import { SMART_LIST_IDENTITY, type SmartListId } from '@/lib/smart-list-identity'

interface SmartListIconProps {
  list: SmartListId
  className?: string
  strokeWidth?: number
}

/** The icon of a smart list in its identity colour. The colour never goes on text. */
export function SmartListIcon({ list, className, strokeWidth = 1.8 }: SmartListIconProps) {
  const { icon: Icon, color } = SMART_LIST_IDENTITY[list]
  return <Icon aria-hidden className={cn('shrink-0', className)} style={{ color }} strokeWidth={strokeWidth} />
}
