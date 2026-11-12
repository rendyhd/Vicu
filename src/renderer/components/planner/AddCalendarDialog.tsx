import { useEffect, useId, useRef, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Dialog } from '@/components/overlay/Dialog'
import { Button } from '@/components/shared/Button'
import { Checkbox } from '@/components/shared/Checkbox'
import { cn } from '@/lib/cn'
import { useCalendarActions } from '@/hooks/use-calendar-events'
import { isMacPlatform, MacCalendarsForm } from './MacCalendarsForm'
import { CALDAV_PRESETS, caldavPreset, type CaldavDraft, type CaldavPresetId } from '../../../shared/calendar-sources'
import { CALENDAR_ACCOUNT_PROVIDERS } from '../../../shared/calendar-accounts'
import { OAuthAccountForm } from './OAuthAccountForm'
import { PickCalendars } from './PickCalendars'
import { CalendarFileForm, isWindowsPlatform, OutlookForm } from './LocalCalendarForms'

// Add a calendar (contract 20.9): a calendar link, a CalDAV account, a Microsoft 365 or Google
// account, the Mac's calendars, a calendar file on this computer, or classic Outlook on Windows. The
// link, the password and the tokens stay in the main process and are never read back; nothing is
// saved until the calendar was read (a link, a file) or the calendars were picked (an account).

type Kind = 'link' | 'account' | 'microsoft' | 'google' | 'mac' | 'file' | 'outlook'

/** The kinds the dialog offers, in order. */
const KINDS: { value: Kind; label: string; summary: string }[] = [
  { value: 'link', label: 'Calendar link', summary: 'A secret address of a calendar (iCal, .ics). Read every few minutes.' },
  { value: 'account', label: 'CalDAV account', summary: 'iCloud, Fastmail, Nextcloud and other CalDAV servers. Pick which calendars to show.' },
  { value: 'microsoft', label: CALENDAR_ACCOUNT_PROVIDERS.microsoft.label, summary: CALENDAR_ACCOUNT_PROVIDERS.microsoft.summary },
  { value: 'google', label: CALENDAR_ACCOUNT_PROVIDERS.google.label, summary: CALENDAR_ACCOUNT_PROVIDERS.google.summary },
  {
    value: 'mac',
    label: 'Mac calendars',
    summary:
      'The calendars in macOS Calendar: iCloud, Google, Exchange and every account in System Settings, Internet Accounts. No sign-in in Vicu; they stay on this Mac.',
  },
  {
    value: 'outlook',
    label: 'Classic Outlook',
    summary: 'The calendars of classic Outlook on this PC, read while Outlook is open. They stay on this PC.',
  },
  {
    value: 'file',
    label: 'Calendar file',
    summary:
      'An .ics file on this computer that another program keeps up to date: Thunderbird, a script, an export. Read again whenever the file changes; it stays on this computer.',
  },
]

/** The kinds offered on this computer: Mac calendars only on macOS, classic Outlook only on Windows. */
const kindsHere = () => KINDS.filter((k) => (k.value !== 'mac' || isMacPlatform()) && (k.value !== 'outlook' || isWindowsPlatform()))

const INPUT =
  'w-full rounded-control border border-border bg-transparent px-2 py-1 text-meta text-text placeholder:text-text-secondary'

/** Where each provider keeps the secret iCalendar address, in its own words. */
const LINK_HELP: { name: string; where: string }[] = [
  { name: 'Google', where: 'a calendar’s Settings, Integrate calendar, "Secret address in iCal format".' },
  { name: 'Outlook', where: 'Settings, Calendar, Shared calendars, Publish a calendar, the ICS link.' },
  { name: 'iCloud', where: 'share the calendar as a Public Calendar and copy its link (or add iCloud as a CalDAV account).' },
  { name: 'Proton', where: 'the calendar’s Share, Share via link ("Limited view" gives busy times only).' },
]

export function Segmented<T extends string>({ label, value, options, onChange, data }: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  data?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          data-calendar-choice={data ? `${data}:${option.value}` : undefined}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-chip border px-2.5 py-0.5 text-meta',
            value === option.value
              ? 'border-accent-blue bg-accent-blue/12 text-accent-blue'
              : 'border-border text-text-secondary hover:bg-bg-hover',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function LinkForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { add } = useCalendarActions()
  const nameId = useId()
  const urlId = useId()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busyOnly, setBusyOnly] = useState(false)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!url.trim() || add.isPending) return
    add.mutate({ name: name.trim() || 'Calendar', url, busyOnly }, { onSuccess: onDone })
  }

  return (
    <form onSubmit={submit} className="space-y-2.5">
      <div>
        <label htmlFor={nameId} className="mb-1 block text-caption text-text-secondary">Name</label>
        <input id={nameId} value={name} onChange={(e) => setName(e.target.value)} placeholder="Work" data-calendar-name data-autofocus className={INPUT} />
      </div>
      <div>
        <label htmlFor={urlId} className="mb-1 block text-caption text-text-secondary">Calendar link</label>
        <input
          id={urlId}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https:// or webcal://"
          spellCheck={false}
          autoComplete="off"
          data-calendar-url
          className={INPUT}
        />
      </div>
      <label className="flex cursor-pointer items-center gap-2">
        <Checkbox checked={busyOnly} onChange={(e) => setBusyOnly(e.target.checked)} data-calendar-busy-only />
        <span className="text-meta text-text">Show only &ldquo;Busy&rdquo;, not titles</span>
      </label>
      <div className="rounded-control bg-bg-hover px-2.5 py-2">
        <p className="text-caption font-medium text-text">Where to find the secret link</p>
        <ul className="mt-1 space-y-0.5">
          {LINK_HELP.map((help) => (
            <li key={help.name} className="text-caption text-text-secondary">
              <span className="font-medium text-text">{help.name}:</span> {help.where}
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-caption text-text-secondary">
          Anyone with the link can read the calendar. For a work calendar, add it only if your organisation allows
          publishing it, and prefer a free/busy share.
        </p>
      </div>
      {add.error && <p role="alert" className="text-caption text-status-overdue" data-calendar-add-error>{(add.error as Error).message}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!url.trim() || add.isPending} data-calendar-add>
          {add.isPending ? 'Reading...' : 'Add calendar'}
        </Button>
      </div>
    </form>
  )
}

function AccountForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { discover } = useCalendarActions()
  const serverId = useId()
  const userId = useId()
  const passwordId = useId()
  const [presetId, setPresetId] = useState<CaldavPresetId>('icloud')
  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [draft, setDraft] = useState<CaldavDraft | null>(null)
  const preset = caldavPreset(presetId)
  const needsServer = !preset.server
  // A signed-in account not added yet is let go of when the dialog closes.
  const draftRef = useRef<string | null>(null)
  draftRef.current = draft?.draftId ?? null
  useEffect(() => () => {
    if (draftRef.current) void window.api.calendar.caldavCancel(draftRef.current)
  }, [])

  const signIn = (event: React.FormEvent) => {
    event.preventDefault()
    if (discover.isPending || !username.trim() || !password || (needsServer && !server.trim())) return
    discover.mutate(
      { preset: presetId, server: needsServer ? server : undefined, username, password },
      {
        onSuccess: (found) => {
          // The password stays in the main process now; the form lets go of it.
          setPassword('')
          setDraft(found)
        },
      },
    )
  }

  const back = () => {
    if (draft) void window.api.calendar.caldavCancel(draft.draftId)
    setDraft(null)
  }

  if (draft) return <PickCalendars draft={draft} onBack={back} onDone={onDone} />

  return (
    <form onSubmit={signIn} className="space-y-2.5" autoComplete="off">
      <Segmented
        label="Provider"
        value={presetId}
        data="preset"
        options={CALDAV_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
        onChange={(value) => {
          setPresetId(value)
          discover.reset()
        }}
      />
      {needsServer && (
        <div>
          <label htmlFor={serverId} className="mb-1 block text-caption text-text-secondary">Server address</label>
          <input
            id={serverId}
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder={presetId === 'nextcloud' ? 'cloud.example.com' : 'https://dav.example.com'}
            spellCheck={false}
            data-caldav-server
            className={INPUT}
          />
        </div>
      )}
      <div>
        <label htmlFor={userId} className="mb-1 block text-caption text-text-secondary">{preset.userLabel}</label>
        <input id={userId} value={username} onChange={(e) => setUsername(e.target.value)} spellCheck={false} autoComplete="off" data-caldav-user data-autofocus className={INPUT} />
      </div>
      <div>
        <label htmlFor={passwordId} className="mb-1 block text-caption text-text-secondary">App password</label>
        <input
          id={passwordId}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          data-caldav-password
          className={INPUT}
        />
        <p className="mt-1 text-caption text-text-secondary">
          {preset.passwordHelp}{' '}
          {preset.passwordUrl && (
            <a href={preset.passwordUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent-blue underline">
              Make an app password
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
        </p>
      </div>
      <p className="text-caption text-text-secondary">
        Vicu only reads your calendars, never changes them. The password is kept encrypted on this computer.
      </p>
      {discover.error && <p role="alert" className="text-caption text-status-overdue" data-caldav-error>{(discover.error as Error).message}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          type="submit"
          disabled={discover.isPending || !username.trim() || !password || (needsServer && !server.trim())}
          data-caldav-sign-in
        >
          {discover.isPending ? 'Signing in...' : 'Sign in'}
        </Button>
      </div>
    </form>
  )
}

/** The add flow, in a modal dialog: Calendar link or CalDAV account. */
export function AddCalendarDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const titleId = useId()
  const [kind, setKind] = useState<Kind>('link')
  return (
    <Dialog open={open} onClose={onClose} labelledBy={titleId} className="w-[460px] max-w-[92vw]">
      <div className="space-y-3 p-5" data-calendar-dialog>
        <h2 id={titleId} className="text-card-title font-semibold text-text">Add a calendar</h2>
        <Segmented label="Kind of calendar" value={kind} data="kind" options={kindsHere()} onChange={setKind} />
        <p className="text-caption text-text-secondary">{KINDS.find((k) => k.value === kind)?.summary}</p>
        {kind === 'link' && <LinkForm onDone={onClose} onCancel={onClose} />}
        {kind === 'account' && <AccountForm onDone={onClose} onCancel={onClose} />}
        {(kind === 'microsoft' || kind === 'google') && <OAuthAccountForm key={kind} provider={kind} onDone={onClose} onCancel={onClose} />}
        {kind === 'mac' && <MacCalendarsForm onDone={onClose} onCancel={onClose} />}
        {kind === 'file' && <CalendarFileForm onDone={onClose} onCancel={onClose} />}
        {kind === 'outlook' && <OutlookForm onDone={onClose} onCancel={onClose} />}
      </div>
    </Dialog>
  )
}
