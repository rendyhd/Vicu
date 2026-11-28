import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Button } from '@/components/shared/Button'
import { Checkbox } from '@/components/shared/Checkbox'
import { useCalendarActions } from '@/hooks/use-calendar-events'
import type { CaldavDraft } from '../../../shared/calendar-sources'

/** A signed-in account's calendars, to pick which to show (CalDAV, Microsoft 365, Google). */
export function PickCalendars({ draft, onBack, onDone, intro }: { draft: CaldavDraft; onBack: () => void; onDone: () => void; intro?: React.ReactNode }) {
  const { t } = useTranslation()
  const { saveAccount } = useCalendarActions()
  // What the account itself hides (a Google calendar unticked there) starts unticked.
  const [shown, setShown] = useState<Set<string>>(() => new Set(draft.calendars.filter((c) => c.suggested !== false).map((c) => c.remoteId)))
  const [busyOnly, setBusyOnly] = useState(false)
  const toggle = (remoteId: string, on: boolean) => {
    const next = new Set(shown)
    if (on) next.add(remoteId)
    else next.delete(remoteId)
    setShown(next)
  }
  return (
    <form
      className="space-y-2.5"
      onSubmit={(event) => {
        event.preventDefault()
        if (shown.size === 0 || saveAccount.isPending) return
        saveAccount.mutate({ draftId: draft.draftId, input: { shown: [...shown], busyOnly } }, { onSuccess: onDone })
      }}
    >
      <p className="text-meta text-text">
        {intro ?? (
          <Trans
            i18nKey="calendars.pick.signedIn"
            values={{ detail: draft.detail }}
            components={{ who: <span className="font-medium" data-calendar-signed-in /> }}
          />
        )}{' '}
        {t('calendars.pick.pick')}
      </p>
      <ul className="max-h-56 overflow-y-auto" data-calendar-found>
        {draft.calendars.map((calendar) => (
          <li key={calendar.remoteId}>
            <label className="flex cursor-pointer items-center gap-2 py-1">
              <Checkbox checked={shown.has(calendar.remoteId)} onChange={(e) => toggle(calendar.remoteId, e.target.checked)} data-calendar-found-item={calendar.name} />
              <span className="text-meta text-text">{calendar.name}</span>
            </label>
          </li>
        ))}
      </ul>
      <label className="flex cursor-pointer items-center gap-2 border-t border-border pt-2">
        <Checkbox checked={busyOnly} onChange={(e) => setBusyOnly(e.target.checked)} data-calendar-pick-busy-only />
        <span className="text-meta text-text">{t('calendars.feeds.busyOnly')}</span>
      </label>
      {saveAccount.error && <p role="alert" className="text-caption text-status-overdue">{(saveAccount.error as Error).message}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onBack}>{t('planner.planMyDay.back')}</Button>
        <Button variant="primary" type="submit" disabled={shown.size === 0 || saveAccount.isPending} data-calendar-account-save>
          {t('calendars.pick.add', { count: shown.size })}
        </Button>
      </div>
    </form>
  )
}
