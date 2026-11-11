import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, ExternalLink } from 'lucide-react'
import { Button } from '@/components/shared/Button'
import { cn } from '@/lib/cn'
import { shownError, useCalendarAccountActions, useOAuthClients } from '@/hooks/use-calendar-accounts'
import {
  CALENDAR_ACCOUNT_PROVIDERS,
  CALENDAR_IT_ADMIN_URL,
  CALENDAR_OAUTH_SETUP_URL,
  accountProblem,
  checkOwnClient,
  type CalendarAccountProvider,
  type OAuthClientState,
} from '../../../shared/calendar-accounts'
import type { CaldavDraft } from '../../../shared/calendar-sources'
import { PickCalendars } from './PickCalendars'

// A Microsoft 365 or Google account in the add dialog (plan phase 2e): sign in in the system
// browser, then pick the calendars. Without a registered Vicu client the form says so and offers
// "Use my own client"; with one, that option waits under Advanced.

const INPUT =
  'w-full rounded-control border border-border bg-transparent px-2 py-1 text-meta text-text placeholder:text-text-secondary'

function OutLink({ href, children, data }: { href: string; children: React.ReactNode; data?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" data-calendar-link={data} className="inline-flex items-center gap-0.5 text-accent-blue underline">
      {children}
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  )
}

/** The org-approval sentence with the page for IT, or a plain error. */
export function AccountError({ message }: { message: string }) {
  if (accountProblem(message) === 'org') {
    return (
      <div role="alert" data-calendar-org-approval className="rounded-control border border-status-overdue/40 bg-status-overdue/8 px-2.5 py-2">
        <p className="text-caption text-text">{message}</p>
        <p className="mt-1 text-caption text-text-secondary">
          An administrator of your Microsoft 365 organisation can allow it for everyone.{' '}
          <OutLink href={CALENDAR_IT_ADMIN_URL} data="it-admins">The page for your IT team</OutLink>
        </p>
      </div>
    )
  }
  return <p role="alert" className="text-caption text-status-overdue" data-calendar-account-error>{message}</p>
}

function OwnClientForm({ provider, state, onSaved }: { provider: CalendarAccountProvider; state: OAuthClientState; onSaved: () => void }) {
  const info = CALENDAR_ACCOUNT_PROVIDERS[provider]
  const { setClient } = useCalendarAccountActions()
  const idId = useId()
  const secretId = useId()
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const save = () => {
    const checked = checkOwnClient(provider, { clientId, clientSecret: info.needsSecret ? secret : undefined })
    if (!checked.ok) {
      setProblem(checked.error)
      return
    }
    setProblem(null)
    setClient.mutate({ provider, input: checked.value }, {
      onSuccess: () => {
        setSecret('')
        onSaved()
      },
    })
  }
  const error = problem ?? (setClient.error ? (setClient.error as Error).message : null)

  return (
    <div className="space-y-2" data-calendar-own-client>
      {state.own && (
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-caption text-text-secondary">
            Using your own client <span className="font-medium text-text" data-calendar-own-client-id>{state.ownClientId}</span>
          </p>
          <Button variant="quiet" onClick={() => setClient.mutate({ provider, input: null })} data-calendar-own-client-remove>
            Remove
          </Button>
        </div>
      )}
      <div>
        <label htmlFor={idId} className="mb-1 block text-caption text-text-secondary">Client id</label>
        <input
          id={idId}
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder={info.clientIdHint}
          spellCheck={false}
          autoComplete="off"
          data-calendar-client-id
          className={INPUT}
        />
      </div>
      {info.needsSecret && (
        <div>
          <label htmlFor={secretId} className="mb-1 block text-caption text-text-secondary">Client secret</label>
          <input
            id={secretId}
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="new-password"
            data-calendar-client-secret
            className={INPUT}
          />
        </div>
      )}
      <p className="text-caption text-text-secondary">
        {provider === 'microsoft'
          ? 'A Microsoft Entra app registration with the "Mobile and desktop applications" platform, redirect URI http://localhost.'
          : 'A Google Cloud OAuth client of the type Desktop app, with the Google Calendar API turned on.'}{' '}
        <OutLink href={CALENDAR_OAUTH_SETUP_URL} data="oauth-setup">How to register one</OutLink>
      </p>
      {error && <p role="alert" className="text-caption text-status-overdue" data-calendar-client-error>{error}</p>}
      <div className="flex justify-end">
        <Button variant="secondary" onClick={save} disabled={!clientId.trim() || setClient.isPending} data-calendar-client-save>
          {state.own ? 'Save new client' : 'Save client'}
        </Button>
      </div>
    </div>
  )
}

export function OAuthAccountForm({ provider, onDone, onCancel }: { provider: CalendarAccountProvider; onDone: () => void; onCancel: () => void }) {
  const info = CALENDAR_ACCOUNT_PROVIDERS[provider]
  const clients = useOAuthClients()
  const { signIn, cancel } = useCalendarAccountActions()
  const [draft, setDraft] = useState<CaldavDraft | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const advancedId = useId()
  const state = clients.data?.[provider]
  const hasClient = state ? state.official || state.own : false

  // A signed-in account not added yet is let go of when the dialog closes; a waiting sign-in stops.
  const draftRef = useRef<string | null>(null)
  draftRef.current = draft?.draftId ?? null
  const pendingRef = useRef(false)
  pendingRef.current = signIn.isPending
  useEffect(() => () => {
    if (draftRef.current) void window.api.calendar.caldavCancel(draftRef.current)
    if (pendingRef.current) cancel()
  }, [])

  if (draft) {
    return (
      <PickCalendars
        draft={draft}
        onDone={onDone}
        onBack={() => {
          void window.api.calendar.caldavCancel(draft.draftId)
          setDraft(null)
        }}
      />
    )
  }
  if (!state) return <p className="text-caption text-text-secondary">Loading...</p>

  const error = shownError(signIn.error)
  const start = () => {
    if (signIn.isPending) return
    signIn.mutate(provider, { onSuccess: (found) => setDraft(found) })
  }

  return (
    <div className="space-y-2.5" data-calendar-oauth={provider}>
      {!hasClient ? (
        <div role="note" data-calendar-no-client className="rounded-control border border-status-today/40 bg-status-today/10 px-2.5 py-2">
          <p className="text-caption text-text">
            This version of Vicu has no {info.label} sign-in registered yet. To connect now, register your own OAuth client and enter it here.
          </p>
        </div>
      ) : (
        <p className="text-caption text-text-secondary">
          Vicu opens your browser to sign in. It asks only to {info.permission.charAt(0).toLowerCase()}{info.permission.slice(1)} The sign-in is kept
          encrypted on this computer and never sent to your Vikunja server.
        </p>
      )}

      {!hasClient ? (
        <OwnClientForm provider={provider} state={state} onSaved={() => setAdvanced(false)} />
      ) : (
        <div>
          <button
            type="button"
            aria-expanded={advanced}
            aria-controls={advancedId}
            onClick={() => setAdvanced((open) => !open)}
            data-calendar-advanced
            className="flex items-center gap-1 rounded-control text-caption text-text-secondary hover:text-text"
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-fade-fast', !advanced && '-rotate-90')} aria-hidden="true" />
            {state.own ? 'Advanced: your own OAuth client' : 'Advanced: use my own client'}
          </button>
          {advanced && (
            <div id={advancedId} className="mt-2 border-l-2 border-border pl-3">
              <OwnClientForm provider={provider} state={state} onSaved={() => setAdvanced(false)} />
            </div>
          )}
        </div>
      )}

      {signIn.isPending && (
        <p role="status" className="text-caption text-text" data-calendar-waiting>
          Finish signing in in your browser, then come back here.
        </p>
      )}
      {error && <AccountError message={error} />}

      <div className="flex justify-end gap-2 pt-1">
        {signIn.isPending ? (
          <Button variant="secondary" onClick={cancel} data-calendar-oauth-cancel>Stop waiting</Button>
        ) : (
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        )}
        {/* Not disabled while waiting, so focus stays in the dialog; a second press does nothing. */}
        <Button variant="primary" onClick={start} disabled={!hasClient} aria-busy={signIn.isPending || undefined} data-calendar-oauth-sign-in>
          {signIn.isPending ? 'Waiting for the browser...' : `Sign in with ${info.label}`}
        </Button>
      </div>
    </div>
  )
}
