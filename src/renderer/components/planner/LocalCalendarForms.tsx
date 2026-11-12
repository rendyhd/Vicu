import { useEffect, useId, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/shared/Button'
import { Checkbox } from '@/components/shared/Checkbox'
import { CALENDAR_SOURCES_KEY, invalidateCalendars } from '@/hooks/use-calendar-events'
import { PickCalendars } from './PickCalendars'
import type { CaldavDraft } from '../../../shared/calendar-sources'

// Calendars that stay on this computer (contract 20.9): a calendar file that another program keeps
// up to date, and classic Outlook on Windows. The file is chosen in the main process's own dialog,
// so this window never sees its path; Outlook is read only while it is open, and only after the
// user has read what that means and ticked that they may.

export const isWindowsPlatform = (): boolean => window.api.platform === 'win32'

const INPUT =
  'w-full rounded-control border border-border bg-transparent px-2 py-1 text-meta text-text placeholder:text-text-secondary'

export function CalendarFileForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const client = useQueryClient()
  const nameId = useId()
  const [name, setName] = useState('')
  const [busyOnly, setBusyOnly] = useState(false)
  const add = useMutation({
    mutationFn: async () => {
      const result = await window.api.calendar.addFile({ name: name.trim() || undefined, busyOnly })
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSuccess: (connection) => {
      // Null: the file dialog was cancelled, the form stays.
      if (!connection) return
      void client.invalidateQueries({ queryKey: [CALENDAR_SOURCES_KEY] })
      invalidateCalendars(client)
      onDone()
    },
    meta: { silent: true },
  })

  return (
    <form
      className="space-y-2.5"
      onSubmit={(event) => {
        event.preventDefault()
        if (!add.isPending) add.mutate()
      }}
    >
      <div>
        <label htmlFor={nameId} className="mb-1 block text-caption text-text-secondary">Name</label>
        <input id={nameId} value={name} onChange={(e) => setName(e.target.value)} placeholder="The file's name" data-calendar-file-name data-autofocus className={INPUT} />
      </div>
      <label className="flex cursor-pointer items-center gap-2">
        <Checkbox checked={busyOnly} onChange={(e) => setBusyOnly(e.target.checked)} data-calendar-busy-only />
        <span className="text-meta text-text">Show only &ldquo;Busy&rdquo;, not titles</span>
      </label>
      <div className="rounded-control bg-bg-hover px-2.5 py-2">
        <p className="text-caption font-medium text-text">Good to know</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-caption text-text-secondary">
          <li>Vicu only reads the file, never changes it, and reads it again as soon as it changes.</li>
          <li>Keep the file where it is. If it moves, remove this calendar and add the file again.</li>
          <li>To copy events into Vicu once instead, use Import calendar file.</li>
        </ul>
      </div>
      {add.error && <p role="alert" className="text-caption text-status-overdue" data-calendar-file-error>{(add.error as Error).message}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={add.isPending} data-calendar-file-choose>
          {add.isPending ? 'Reading...' : 'Choose file...'}
        </Button>
      </div>
    </form>
  )
}

const OUTLOOK_STATUS_KEY = 'calendar-outlook-status'

export function OutlookForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const client = useQueryClient()
  const status = useQuery({ queryKey: [OUTLOOK_STATUS_KEY], queryFn: () => window.api.calendar.outlook.status() })
  const [allowed, setAllowed] = useState(false)
  const [draft, setDraft] = useState<CaldavDraft | null>(null)
  // Calendars listed but not added yet are let go of when the dialog closes.
  const draftRef = useRef<string | null>(null)
  draftRef.current = draft?.draftId ?? null
  useEffect(() => () => {
    if (draftRef.current) void window.api.calendar.caldavCancel(draftRef.current)
  }, [])
  // Back from opening Outlook: it may be running now.
  const refetchStatus = status.refetch
  useEffect(() => {
    const onFocus = () => void refetchStatus()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refetchStatus])

  const discover = useMutation({
    mutationFn: async () => {
      const result = await window.api.calendar.outlook.discover()
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSuccess: setDraft,
    onSettled: () => void client.invalidateQueries({ queryKey: [OUTLOOK_STATUS_KEY] }),
    meta: { silent: true },
  })

  if (draft) {
    return (
      <PickCalendars
        draft={draft}
        intro={<>Classic Outlook has these calendars.</>}
        onBack={() => {
          void window.api.calendar.caldavCancel(draft.draftId)
          setDraft(null)
        }}
        onDone={onDone}
      />
    )
  }

  const view = status.data
  const missing = view?.state === 'missing'
  const canContinue = !!view && !missing && !view.added && allowed && !discover.isPending

  return (
    <form
      className="space-y-2.5"
      onSubmit={(event) => {
        event.preventDefault()
        if (canContinue) discover.mutate()
      }}
      data-calendar-outlook
    >
      <div className="rounded-control bg-bg-hover px-2.5 py-2">
        <p className="text-caption font-medium text-text">Before you add it</p>
        <ul className="mt-1 list-disc space-y-1 pl-4 text-caption text-text-secondary">
          <li>
            Only <span className="font-medium text-text">classic Outlook</span> can be read, and only while it is open. Vicu never starts
            it. The new Outlook has no way for other apps to read it: use a Microsoft 365 account or a calendar link for it.
          </li>
          <li>
            Outlook may ask whether to allow a program to access its data. Vicu reads only titles, places, times and how you answered,
            not people or messages.
          </li>
          <li>
            On a work PC, this shows your organisation&rsquo;s calendar in Vicu. It stays on this PC and is never sent anywhere, but
            check that your organisation allows it.
          </li>
        </ul>
      </div>
      {view?.added && <p className="text-caption text-text-secondary">Classic Outlook is already added. Choose which of its calendars to show in the list.</p>}
      {view?.problem && !view.added && !discover.error && (
        <p className="text-caption text-status-overdue" data-calendar-outlook-problem>{view.problem}</p>
      )}
      {!missing && !view?.added && (
        <label className="flex cursor-pointer items-start gap-2">
          <Checkbox checked={allowed} onChange={(e) => setAllowed(e.target.checked)} data-calendar-outlook-allowed />
          <span className="text-meta text-text">These are my calendars, and I may show them in Vicu on this PC</span>
        </label>
      )}
      {discover.error && <p role="alert" className="text-caption text-status-overdue" data-calendar-outlook-error>{(discover.error as Error).message}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!canContinue} data-calendar-outlook-continue>
          {discover.isPending ? 'Reading Outlook...' : 'Continue'}
        </Button>
      </div>
    </form>
  )
}
