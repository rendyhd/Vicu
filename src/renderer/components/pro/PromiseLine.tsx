import { useTranslation } from 'react-i18next'
import { useGroups } from '@/hooks/use-groups'
import { usePersonLabels } from '@/hooks/use-people'
import type { PromiseValue } from '../../../shared/pro/ledger'
import { requesterOf } from '../../../shared/pro/promises'

/**
 * Who a promise is from and who it was made to, on a row's meta line (cross-app semantics 21.6):
 * "From Lalith", "From Lalith, for Leadership team", "For Priya", and "Yours, for Leadership team"
 * for your own action of a group.
 */
export function PromiseLine({ promise, personName, theirs }: { promise: PromiseValue; personName: string; theirs: boolean }) {
  const { t } = useTranslation()
  const groups = useGroups()
  const people = usePersonLabels()
  const requester = requesterOf(promise)
  const to =
    requester.kind === 'group' ? groups.nameOf(requester.group)
    : requester.kind === 'person' ? people.get(requester.person)?.title ?? null
    : requester.kind === 'text' ? requester.text
    : null
  const text = theirs
    ? to ? t('pro.promise.fromFor', { owner: personName, requester: to }) : t('pro.promise.from', { name: personName })
    : promise.person == null
      ? to ? t('pro.promise.yoursFor', { requester: to }) : t('pro.promise.yours')
      : t('pro.promise.for', { name: personName })
  return <span className="shrink-0" data-pro-promise={theirs ? 'theirs' : 'mine'}>{text}</span>
}
