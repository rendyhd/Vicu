import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Menu, MenuHeading, MenuItem } from '@/components/overlay/Menu'
import type { EventScope } from '../../../shared/plan-events'

interface EventScopeMenuProps {
  /** The event (a keyboard change), or the point where a drag was let go. */
  anchorRef?: RefObject<HTMLElement | null>
  anchorPoint?: { x: number; y: number }
  title: string
  onChoose: (scope: EventScope) => void
  /** Escape or a press outside: nothing changes. */
  onCancel: () => void
}

/** Which times a change of a repeating Event is for (contract 20.6), asked when a move is let go. */
export function EventScopeMenu({ anchorRef, anchorPoint, title, onChoose, onCancel }: EventScopeMenuProps) {
  const { t } = useTranslation()
  return (
    <Menu anchorRef={anchorRef} anchorPoint={anchorPoint} label={t('events.scope.menuLabel', { title })} onClose={onCancel} placement="bottom-start">
      <MenuHeading>{t('events.scope.heading')}</MenuHeading>
      <MenuItem onSelect={() => onChoose('this')}>{t('events.scope.thisTime')}</MenuItem>
      <MenuItem onSelect={() => onChoose('following')}>{t('events.scope.following')}</MenuItem>
      <MenuItem onSelect={() => onChoose('all')}>{t('events.scope.all')}</MenuItem>
    </Menu>
  )
}
