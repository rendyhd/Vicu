import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/shared/Button'
import { Checkbox } from '@/components/shared/Checkbox'
import { invalidateCalendars, CALENDAR_SOURCES_KEY } from '@/hooks/use-calendar-events'
import { groupByAccount, type EventKitFoundCalendar } from '../../../shared/calendar-eventkit'

// Add the calendars of this Mac (EventKit, contract 20.9, docs/calendar-plan.md 2d): everything in
// System Settings, Internet Accounts, without a sign-in in Vicu. Continue asks macOS for the
// permission (once), then the calendars are listed by account to pick. Offered on macOS only.

export const isMacPlatform = (): boolean => window.api.platform === 'darwin'

const STATUS_KEY = 'calendar-eventkit-status'

export function MacCalendarsForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const client = useQueryClient()
  const status = useQuery({ queryKey: [STATUS_KEY], queryFn: () => window.api.calendar.eventkit.status() })
  const [found, setFound] = useState<EventKitFoundCalendar[] | null>(null)
  const [shown, setShown] = useState<Set<string>>(new Set())
  const [busyOnly, setBusyOnly] = useState(false)
  // Back from System Settings: what macOS allows may have changed.
  const refetchStatus = status.refetch
  useEffect(() => {
    const onFocus = () => void refetchStatus()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refetchStatus])

  const discover = useMutation({
    mutationFn: async () => {
      const result = await window.api.calendar.eventkit.discover()
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSuccess: (calendars) => {
      setFound(calendars)
      setShown(new Set(calendars.filter((calendar) => calendar.suggested).map((calendar) => calendar.remoteId)))
    },
    onSettled: () => void client.invalidateQueries({ queryKey: [STATUS_KEY] }),
    meta: { silent: true },
  })
  const save = useMutation({
    mutationFn: async () => {
      const result = await window.api.calendar.eventkit.save({ shown: [...shown], busyOnly })
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [CALENDAR_SOURCES_KEY] })
      invalidateCalendars(client)
      onDone()
    },
    meta: { silent: true },
  })

  const view = status.data
  const refused = view?.access === 'denied' || view?.access === 'restricted' || view?.access === 'write-only'

  if (found) {
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
          if (shown.size === 0 || save.isPending) return
          save.mutate()
        }}
      >
        <p className="text-meta text-text">Pick the calendars to show.</p>
        <div className="max-h-64 space-y-2 overflow-y-auto" data-eventkit-found>
          {groupByAccount(found).map((group) => (
            <div key={group.account}>
              <p className="text-caption font-medium text-text-secondary">{group.account}</p>
              <ul>
                {group.calendars.map((calendar) => (
                  <li key={calendar.remoteId}>
                    <label className="flex cursor-pointer items-center gap-2 py-1">
                      <Checkbox checked={shown.has(calendar.remoteId)} onChange={(e) => toggle(calendar.remoteId, e.target.checked)} />
                      {calendar.color && (
                        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: calendar.color }} />
                      )}
                      <span className="text-meta text-text">{calendar.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 border-t border-border pt-2">
          <Checkbox checked={busyOnly} onChange={(e) => setBusyOnly(e.target.checked)} />
          <span className="text-meta text-text">Show only &ldquo;Busy&rdquo;, not titles</span>
        </label>
        {save.error && <p role="alert" className="text-caption text-status-overdue">{(save.error as Error).message}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={shown.size === 0 || save.isPending} data-eventkit-save>
            {shown.size === 1 ? 'Add 1 calendar' : `Add ${shown.size} calendars`}
          </Button>
        </div>
      </form>
    )
  }

  const problem = discover.error ? (discover.error as Error).message : view?.added ? undefined : view?.problem
  return (
    <div className="space-y-2.5">
      <p className="text-caption text-text-secondary">Vicu only reads them, never changes them.</p>
      {view?.added && (
        <p className="text-meta text-text" data-eventkit-added>
          The calendars of this Mac are already added. Choose which to show in the list of calendars.
        </p>
      )}
      {!view?.added && view?.access === 'not-determined' && (
        <p className="text-caption text-text-secondary">macOS asks once whether Vicu may read your calendars.</p>
      )}
      {problem && <p role="alert" className="text-caption text-status-overdue" data-eventkit-error>{problem}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        {refused && !view?.added ? (
          <Button variant="primary" onClick={() => void window.api.calendar.eventkit.openSettings()} data-eventkit-settings>
            Open System Settings
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => discover.mutate()}
            disabled={!view || view.added || discover.isPending || (!view.access && !!view.problem)}
            data-eventkit-continue
          >
            {discover.isPending ? 'Waiting for macOS...' : 'Continue'}
          </Button>
        )}
      </div>
    </div>
  )
}
