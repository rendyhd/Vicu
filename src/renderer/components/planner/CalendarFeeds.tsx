import { useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/shared/Button'
import { Checkbox } from '@/components/shared/Checkbox'
import { useCalendarFeedActions, useCalendarFeeds } from '@/hooks/use-calendar-events'
import { usePlanEventActions, usePlanEvents } from '@/hooks/use-plan-events'
import { formatLength } from '@/lib/planner-timeline'
import type { CalendarFeedView } from '../../../shared/calendar-events'
import { MY_EVENTS_COLOR, repeatText, type ListedEvent } from '../../../shared/plan-events'

/** Your own Events, to look over and delete; they are added and changed on the timeline. */
function MyEvents() {
  const { events } = usePlanEvents()
  const actions = usePlanEventActions()
  return (
    <div data-plan-my-events className="mb-3">
      <p className="text-meta font-medium text-text">Events</p>
      <p className="mt-1 text-caption text-text-secondary">
        Times you are not available, such as a weekly manager call. Drag on the timeline and pick Event to add one.
        Shown on Plan only and synced to your devices.
      </p>
      {events.length > 0 && (
        <ul className="mt-2 space-y-1">
          {events.map((event: ListedEvent) => (
            <li key={event.id} data-plan-my-event={event.id} className="flex items-center gap-2 rounded-control border border-border px-2 py-1">
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: MY_EVENTS_COLOR }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-meta text-text">{event.title}</span>
                <span className="block truncate text-caption text-text-secondary">
                  {repeatText(event.repeat)} · {event.time === null ? 'all day' : `${event.time}, ${formatLength(event.minutes)}`}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Delete ${event.title}`}
                onClick={() => void actions.remove(event)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-text-secondary hover:bg-bg-hover"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** "just now", "4 min ago", "2 h ago". */
function updatedText(iso?: string): string {
  if (!iso) return 'Not read yet'
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'Updated just now'
  if (minutes < 60) return `Updated ${minutes} min ago`
  return `Updated ${Math.round(minutes / 60)} h ago`
}

function FeedRow({ feed }: { feed: CalendarFeedView }) {
  const { update, remove } = useCalendarFeedActions()
  const set = (patch: Parameters<typeof update.mutate>[0]['patch']) => update.mutate({ id: feed.id, patch })
  return (
    <li data-calendar-feed={feed.id} className="rounded-control border border-border p-2">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: feed.color }} />
        <span className="min-w-0 flex-1 truncate text-meta font-medium text-text">{feed.name}</span>
        <button
          type="button"
          aria-label={`Remove ${feed.name}`}
          onClick={() => remove.mutate(feed.id)}
          className="flex h-6 w-6 items-center justify-center rounded-control text-text-secondary hover:bg-bg-hover"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <p className={feed.error ? 'mt-0.5 text-caption text-status-overdue' : 'mt-0.5 text-caption text-text-secondary'}>
        {feed.error ?? updatedText(feed.fetchedAt)}
      </p>
      <div className="mt-1.5 flex flex-col gap-1">
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={feed.enabled} onChange={(event) => set({ enabled: event.target.checked })} />
          <span className="text-meta text-text">Show on the timeline</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={feed.countsAsBusy} onChange={(event) => set({ countsAsBusy: event.target.checked })} />
          <span className="text-meta text-text">Counts as busy time</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={feed.busyOnly} onChange={(event) => set({ busyOnly: event.target.checked })} />
          <span className="text-meta text-text">Show only "Busy", not titles</span>
        </label>
      </div>
    </li>
  )
}

/**
 * Calendars on the timeline (proof of concept): secret ICS links, read on this device only.
 * Shared by the Plan screen's gear and Settings, through PlannerOptions.
 */
export function CalendarFeeds() {
  const feeds = useCalendarFeeds()
  const { add, refresh } = useCalendarFeedActions()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busyOnly, setBusyOnly] = useState(false)
  const list = feeds.data ?? []

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!url.trim()) return
    add.mutate(
      { name: name.trim() || 'Calendar', url, busyOnly },
      {
        onSuccess: () => {
          setName('')
          setUrl('')
          setBusyOnly(false)
        },
      },
    )
  }

  return (
    <div data-calendar-feeds>
      <MyEvents />
      <div className="flex items-center gap-2 border-t border-border pt-3">
        <p className="flex-1 text-meta font-medium text-text">Calendars</p>
        {list.length > 0 && (
          <button
            type="button"
            aria-label="Read the calendars again"
            onClick={() => refresh.mutate()}
            className="flex h-6 w-6 items-center justify-center rounded-control text-text-secondary hover:bg-bg-hover"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      <p className="mt-1 text-caption text-text-secondary">
        Events show on the timeline and count as busy time. Read on this device only and never changed. A preview.
      </p>

      {list.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {list.map((feed) => (
            <FeedRow key={feed.id} feed={feed} />
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="mt-2 space-y-1.5">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name, such as Work"
          aria-label="Calendar name"
          data-calendar-name
          className="w-full rounded-control border border-border bg-transparent px-2 py-1 text-meta text-text placeholder:text-text-secondary"
        />
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Calendar link (https:// or webcal://)"
          aria-label="Calendar link"
          data-calendar-url
          spellCheck={false}
          className="w-full rounded-control border border-border bg-transparent px-2 py-1 text-meta text-text placeholder:text-text-secondary"
        />
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={busyOnly} onChange={(event) => setBusyOnly(event.target.checked)} />
          <span className="text-meta text-text">Show only "Busy", not titles</span>
        </label>
        <div className="flex items-center gap-2">
          <Button type="submit" variant="secondary" disabled={!url.trim() || add.isPending} data-calendar-add>
            {add.isPending ? 'Reading...' : 'Add calendar'}
          </Button>
        </div>
        {add.error && <p className="text-caption text-status-overdue">{(add.error as Error).message}</p>}
      </form>
      <p className="mt-2 text-caption text-text-secondary">
        Use the calendar's secret iCal address: Google, a calendar's settings, "Secret address in iCal format"; Outlook,
        Settings, Calendar, Shared calendars, Publish; Proton, Share via link. Anyone with the link can read the calendar,
        so for a work calendar check that your organisation allows publishing it.
      </p>
    </div>
  )
}
