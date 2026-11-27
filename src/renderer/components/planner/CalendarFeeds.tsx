import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Check, ChevronDown, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/shared/Button'
import { Checkbox } from '@/components/shared/Checkbox'
import { cn } from '@/lib/cn'
import { can } from '@/lib/capabilities'
import { useCalendarActions, useCalendarSources } from '@/hooks/use-calendar-events'
import { usePlanEventActions, usePlanEvents } from '@/hooks/use-plan-events'
import { formatLength } from '@/lib/planner-timeline'
import { CALENDAR_COLOR_NAMES, CALENDAR_COLORS, type CalendarFeedView } from '../../../shared/calendar-events'
import type { CalendarConnectionView, CalendarSecretLevel } from '../../../shared/calendar-sources'
import { MY_EVENTS_COLOR, repeatText, type ListedEvent } from '../../../shared/plan-events'
import { useCalendarAccountActions, shownError } from '@/hooks/use-calendar-accounts'
import { accountProblem } from '../../../shared/calendar-accounts'
import { t as translate } from '../../../shared/i18n'
import { AddCalendarDialog } from './AddCalendarDialog'
import { ImportCalendarFileButton, ImportCalendarHost } from './ImportCalendarFile'
import { AccountError } from './OAuthAccountForm'

// Events and connected calendars (contract 20.3, 20.9) in Settings, Pro, Plan. The Plan screen's
// gear shows a summary with Manage, which opens them here.

const ICON_BUTTON = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-text-secondary hover:bg-bg-hover'

/** Your own Events, to look over and delete; they are added and changed on the timeline. */
function MyEvents() {
  const { t } = useTranslation()
  const { events } = usePlanEvents()
  const actions = usePlanEventActions()
  return (
    <div data-plan-my-events className="mb-3">
      <p className="text-meta font-medium text-text">{t('calendars.feeds.events')}</p>
      <p className="mt-1 text-caption text-text-secondary">
        {t('calendars.feeds.eventsNote')}
      </p>
      <ImportCalendarFileButton className="mt-2" />
      {events.length > 0 && (
        <ul className="mt-2 space-y-1">
          {events.map((event: ListedEvent) => (
            <li key={event.id} data-plan-my-event={event.id} className="flex items-center gap-2 rounded-control border border-border px-2 py-1">
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: MY_EVENTS_COLOR }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-meta text-text">{event.title}</span>
                <span className="block truncate text-caption text-text-secondary">
                  {repeatText(event.repeat)} · {event.time === null ? t('calendars.feeds.allDay') : t('calendars.feeds.timeLength', { time: event.time, length: formatLength(event.minutes) })}
                </span>
              </span>
              <button type="button" aria-label={t('calendars.feeds.deleteEvent', { title: event.title })} onClick={() => void actions.remove(event)} className={ICON_BUTTON}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function clock(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (date.toDateString() === today.toDateString()) return time
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}

/** "Updated 4 min ago"; with an error, "Not updated since 10:42" and why (20.9). */
export function calendarStatus(feed: Pick<CalendarFeedView, 'enabled' | 'fetchedAt' | 'error'>, now = Date.now()): { text: string; problem: boolean } {
  if (feed.error) {
    return { text: feed.fetchedAt ? translate('calendars.feeds.notUpdatedSinceError', { time: clock(feed.fetchedAt), error: feed.error }) : feed.error, problem: true }
  }
  if (!feed.enabled) return { text: translate('calendars.feeds.notShown'), problem: false }
  if (!feed.fetchedAt) return { text: translate('calendars.feeds.notReadYet'), problem: false }
  const minutes = Math.round((now - new Date(feed.fetchedAt).getTime()) / 60_000)
  if (minutes < 1) return { text: translate('calendars.feeds.updatedJustNow'), problem: false }
  if (minutes < 60) return { text: translate('calendars.feeds.updatedMinutesAgo', { count: minutes }), problem: false }
  return { text: translate('calendars.feeds.updatedAt', { time: clock(feed.fetchedAt) }), problem: false }
}

function StorageNotice({ level }: { level: CalendarSecretLevel }) {
  const { t } = useTranslation()
  if (level === 'encrypted') return null
  return (
    <p role="note" data-calendar-storage={level} className="mt-2 rounded-control border border-status-today/40 bg-status-today/10 px-2.5 py-1.5 text-caption text-text-secondary">
      {level === 'obfuscated'
        ? t('calendars.feeds.storageObscured')
        : t('calendars.feeds.storagePlain')}
    </p>
  )
}

function ColorChoice({ feed }: { feed: CalendarFeedView }) {
  const { t } = useTranslation()
  const { update } = useCalendarActions()
  return (
    <div role="radiogroup" aria-label={t('calendars.feeds.colourOf', { name: feed.name })} className="flex gap-1.5">
      {CALENDAR_COLORS.map((color, index) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={feed.color === color}
          aria-label={CALENDAR_COLOR_NAMES[index]}
          data-calendar-color={color}
          onClick={() => update.mutate({ id: feed.id, patch: { color } })}
          // The colour is the calendar's own choice, kept in forced colours too; the tick says which.
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-full border-2 forced-color-adjust-none',
            feed.color === color ? 'border-text' : 'border-transparent hover:border-border',
          )}
          style={{ backgroundColor: color }}
        >
          {feed.color === color && <Check className="h-3 w-3 text-white" strokeWidth={3} aria-hidden="true" />}
        </button>
      ))}
    </div>
  )
}

/**
 * One calendar. `accountSays`: the account above already says why it cannot be read (sign in again,
 * the organisation), so the row only says since when.
 */
function CalendarRow({ feed, onRemove, accountSays = false }: { feed: CalendarFeedView; onRemove?: () => void; accountSays?: boolean }) {
  const { t } = useTranslation()
  const { update } = useCalendarActions()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(feed.name)
  const set = (patch: Parameters<typeof update.mutate>[0]['patch']) => update.mutate({ id: feed.id, patch })
  const said = accountSays && accountProblem(feed.error) !== null
  const status = said
    ? !feed.enabled
      ? { text: t('calendars.feeds.notShown'), problem: false }
      : { text: feed.fetchedAt ? t('calendars.feeds.notUpdatedSince', { time: clock(feed.fetchedAt) }) : t('calendars.feeds.notReadYetDot'), problem: true }
    : calendarStatus(feed)
  const commitName = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== feed.name) set({ name: trimmed })
    else setName(feed.name)
  }

  return (
    <li data-calendar-feed={feed.id} className="rounded-control border border-border px-2 py-1.5">
      <div className="flex items-center gap-2">
        <Checkbox
          checked={feed.enabled}
          aria-label={t('calendars.feeds.show', { name: feed.name })}
          data-calendar-shown
          onChange={(event) => set({ enabled: event.target.checked })}
        />
        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full forced-color-adjust-none" style={{ backgroundColor: feed.color }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-meta font-medium text-text" data-calendar-feed-name>{feed.name}</span>
          <span className={cn('block text-caption', status.problem ? 'text-status-overdue' : 'text-text-secondary')} data-calendar-status>
            {status.text}
            {feed.warning && !status.problem ? ` ${feed.warning}` : ''}
          </span>
        </span>
        <button
          type="button"
          aria-label={t('calendars.feeds.optionsFor', { name: feed.name })}
          aria-expanded={open}
          data-calendar-options
          onClick={() => setOpen((value) => !value)}
          className={ICON_BUTTON}
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-fade-fast', open && 'rotate-180')} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2 border-t border-border pb-1 pl-[26px] pt-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitName()
              }
            }}
            aria-label={t('calendars.feeds.calendarName')}
            data-calendar-rename
            className="w-full rounded-control border border-border bg-transparent px-2 py-1 text-meta text-text"
          />
          <ColorChoice feed={feed} />
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox checked={feed.countsAsBusy} onChange={(event) => set({ countsAsBusy: event.target.checked })} />
            <span className="text-meta text-text">{t('calendars.feeds.busy')}</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox checked={feed.busyOnly} data-calendar-busy-toggle onChange={(event) => set({ busyOnly: event.target.checked })} />
            <span className="text-meta text-text">{t('calendars.feeds.busyOnly')}</span>
          </label>
          {onRemove && (
            <Button variant="quiet" danger onClick={onRemove} data-calendar-remove>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              {t('calendars.feeds.removeCalendar')}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

/** A Microsoft or Google account the provider no longer lets Vicu read: Sign in again, or the page for IT. */
function AccountRepair({ connection }: { connection: CalendarConnectionView }) {
  const { t } = useTranslation()
  const { reconnect, cancel } = useCalendarAccountActions()
  const messages = [connection.error, ...connection.calendars.map((feed) => feed.error)]
  const org = messages.find((message) => accountProblem(message) === 'org')
  const signIn = messages.some((message) => accountProblem(message) === 'sign-in')
  const error = shownError(reconnect.error)
  if (!org && !signIn && !reconnect.isPending && !error) return null
  // The account's own error line says it already; otherwise the first calendar's reason, once.
  const reason = !org && signIn && !connection.error ? messages.find((message) => accountProblem(message) === 'sign-in') : undefined
  return (
    <div className="mt-1.5 space-y-1.5" data-calendar-repair={connection.id}>
      {org && <AccountError message={org} />}
      {reason && <p className="text-caption text-status-overdue">{reason}</p>}
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={() => reconnect.mutate(connection.id)} disabled={reconnect.isPending} data-calendar-sign-in-again>
          {reconnect.isPending ? t('calendars.feeds.waitingBrowser') : t('calendars.feeds.signInAgain')}
        </Button>
        {reconnect.isPending && <Button variant="quiet" onClick={cancel}>{t('calendars.feeds.stopWaiting')}</Button>}
      </div>
      {error && <AccountError message={error} />}
    </div>
  )
}

function ConnectionBlock({ connection }: { connection: CalendarConnectionView }) {
  const { t } = useTranslation()
  const { remove, refresh } = useCalendarActions()
  if (connection.kind === 'ics' || connection.kind === 'ics-file') {
    const feed = connection.calendars[0]
    if (!feed) return null
    return <CalendarRow feed={feed} onRemove={() => remove.mutate(connection.id)} />
  }
  return (
    <li data-calendar-connection={connection.id} className="rounded-control border border-border px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-meta font-medium text-text">{connection.name}</span>
          <span className="block truncate text-caption text-text-secondary">{connection.detail}</span>
        </span>
        <button
          type="button"
          aria-label={t('calendars.feeds.readAgain', { name: connection.name })}
          onClick={() => refresh.mutate(connection.id)}
          disabled={refresh.isPending}
          className={ICON_BUTTON}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refresh.isPending && 'animate-spin')} aria-hidden="true" />
        </button>
        <button type="button" aria-label={t('calendars.feeds.removeAccount', { name: connection.name })} onClick={() => remove.mutate(connection.id)} data-calendar-remove-account className={ICON_BUTTON}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {connection.error && accountProblem(connection.error) !== 'org' && <p className="mt-0.5 text-caption text-status-overdue">{connection.error}</p>}
      {(connection.kind === 'microsoft' || connection.kind === 'google') && <AccountRepair connection={connection} />}
      <ul className="mt-1.5 space-y-1">
        {connection.calendars.map((feed) => (
          <CalendarRow key={feed.id} feed={feed} accountSays={connection.kind === 'microsoft' || connection.kind === 'google'} />
        ))}
      </ul>
    </li>
  )
}

/** The gear's short version: what is connected and how it is doing, and Manage. */
function CalendarSummary() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { events } = usePlanEvents()
  const sources = useCalendarSources()
  const feeds = (sources.data?.connections ?? []).flatMap((connection) => connection.calendars)
  const shown = feeds.filter((feed) => feed.enabled)
  const failing = feeds.filter((feed) => feed.error)
  const eventsCount = t('calendars.feeds.eventsCount', { count: events.length })
  // Connected calendars do not exist in every host (the web version): then only the Events count.
  const summary = can('calendars')
    ? t('calendars.feeds.summaryBoth', { events: eventsCount, calendars: t('calendars.feeds.shownCount', { count: shown.length }) })
    : t('calendars.feeds.summaryEvents', { events: eventsCount })
  return (
    <div data-calendar-summary>
      <p className="text-meta font-medium text-text">{t('calendars.feeds.eventsAndCalendars')}</p>
      <p className="mt-1 text-caption text-text-secondary">{summary}</p>
      {failing.length > 0 && (
        <p className="mt-1 text-caption text-status-overdue">
          {failing.length === 1 ? t('calendars.feeds.couldNotRead', { name: failing[0].name }) : t('calendars.feeds.couldNotReadMany', { count: failing.length })}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" data-calendar-manage onClick={() => void navigate({ to: '/settings', search: { section: 'calendars' } })}>
          {t('calendars.feeds.manage')}
        </Button>
        <ImportCalendarFileButton />
      </div>
    </div>
  )
}

/**
 * Your Events and the connected calendars. In Settings the whole list; in the Plan screen's gear
 * (`summary`) a line and Manage, so the gear stays short.
 */
export function CalendarFeeds({ summary = false }: { summary?: boolean }) {
  const { t } = useTranslation()
  const sources = useCalendarSources()
  const { refresh } = useCalendarActions()
  const [adding, setAdding] = useState(false)
  if (summary) return <CalendarSummary />
  const connections = sources.data?.connections ?? []

  return (
    <div data-calendar-feeds>
      <MyEvents />
      {can('calendars') && (
      <>
      <div className="flex items-center gap-2 border-t border-border pt-3">
        <p className="flex-1 text-meta font-medium text-text">{t('calendars.feeds.calendars')}</p>
        {connections.length > 0 && (
          <button
            type="button"
            aria-label={t('calendars.feeds.readAllAgain')}
            data-calendar-refresh
            onClick={() => refresh.mutate(undefined)}
            disabled={refresh.isPending}
            className={ICON_BUTTON}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refresh.isPending && 'animate-spin')} aria-hidden="true" />
          </button>
        )}
      </div>
      <p className="mt-1 text-caption text-text-secondary">
        {t('calendars.feeds.calendarsNote')}
      </p>
      {sources.data && <StorageNotice level={sources.data.storage} />}

      {connections.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {connections.map((connection) => (
            <ConnectionBlock key={connection.id} connection={connection} />
          ))}
        </ul>
      )}

      <Button variant="secondary" className="mt-2" onClick={() => setAdding(true)} data-calendar-open-add>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        {t('calendars.feeds.addCalendar')}
      </Button>
      <AddCalendarDialog open={adding} onClose={() => setAdding(false)} />
      </>
      )}
      <ImportCalendarHost />
    </div>
  )
}
