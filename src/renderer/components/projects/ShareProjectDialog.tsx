import { useEffect, useId, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../../shared/i18n'
import { Dialog } from '@/components/overlay/Dialog'
import { Button } from '@/components/shared/Button'
import { Avatar } from '@/components/shared/Avatar'
import { displayName } from '@/lib/collaboration'
import { normalizeHex } from '@/lib/constants'
import { useAppConfig } from '@/hooks/use-app-config'
import { useCurrentUser } from '@/hooks/use-current-user'
import { findUserByUsername, useProjectShares, useShareProject } from '@/hooks/use-project-shares'
import { announce } from '@/stores/announcer-store'
import type { PersonRef, Project } from '@/lib/vikunja-types'

// Sharing a project (collaboration D5, cross-app semantics 9.7). Admins add people by exact
// username, change what they may do and remove them; team shares are listed but managed in Vikunja.
// A removal is immediate and offers Undo in the dialog itself: the page behind a modal dialog is
// inert, so a toast's Undo could not be reached while the dialog is open.

const PERMISSIONS: ReadonlyArray<{ value: number; labelKey: TranslationKey }> = [
  { value: 0, labelKey: 'projects.share.canView' },
  { value: 1, labelKey: 'projects.share.canEdit' },
  { value: 2, labelKey: 'projects.share.admin' },
]

/** How long typing rests before the username is looked up. */
const LOOKUP_DELAY_MS = 300

type Lookup =
  | { state: 'idle' }
  | { state: 'looking' }
  | { state: 'found'; person: PersonRef }
  | { state: 'missing' }
  | { state: 'failed'; message: string }

const INPUT =
  'rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]'

interface ShareProjectDialogProps {
  project: Project
  returnFocusTo: HTMLElement | null
  onClose: () => void
}

export function ShareProjectDialog({ project, returnFocusTo, onClose }: ShareProjectDialogProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const usernameId = useId()
  const statusId = useId()
  const { data: me } = useCurrentUser()
  const { data: config } = useAppConfig()
  // Vicu's hidden carriers (custom lists, synced settings, Pro ledger) live in the Inbox (review S-5).
  const isInbox = (config?.inbox_project_id ?? 0) > 0 && config?.inbox_project_id === project.id
  const { data: shares, isLoading, isError } = useProjectShares(project.id)
  const share = useShareProject(project.id)
  const [username, setUsername] = useState('')
  const [permission, setPermission] = useState(1)
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' })
  const [removed, setRemoved] = useState<(PersonRef & { permission: number }) | null>(null)

  useEffect(() => {
    const query = username.trim().replace(/^@/, '')
    if (!query) {
      setLookup({ state: 'idle' })
      return
    }
    setLookup({ state: 'looking' })
    let cancelled = false
    const timer = setTimeout(() => {
      findUserByUsername(query).then(
        (person) => {
          if (!cancelled) setLookup(person ? { state: 'found', person } : { state: 'missing' })
        },
        (error: unknown) => {
          if (!cancelled) setLookup({ state: 'failed', message: error instanceof Error ? error.message : String(error) })
        },
      )
    }, LOOKUP_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [username])

  const owner = project.owner ?? null
  const users = shares?.users ?? []
  const teams = shares?.teams ?? []
  const hasAccess = (person: PersonRef) => person.id === owner?.id || users.some((u) => u.id === person.id)
  const already = lookup.state === 'found' && hasAccess(lookup.person)
  const canShare = lookup.state === 'found' && !already && !share.isPending

  const status =
    lookup.state === 'missing'
      ? t('projects.share.missing')
      : lookup.state === 'failed'
        ? lookup.message
        : already
          ? t('projects.share.alreadyHasAccess')
          : lookup.state === 'found'
            ? `${displayName(lookup.person)} · @${lookup.person.username}`
            : ''

  const add = () => {
    if (lookup.state !== 'found' || already) return
    share.mutate(
      { kind: 'add', username: lookup.person.username, permission },
      { onSuccess: () => setUsername('') },
    )
  }

  const remove = (person: PersonRef & { permission: number }) => {
    share.mutate(
      { kind: 'remove', username: person.username },
      {
        onSuccess: () => {
          setRemoved(person)
          announce(t('projects.share.noAccess', { name: displayName(person) }))
        },
      },
    )
  }

  const undoRemove = () => {
    if (!removed) return
    const person = removed
    share.mutate(
      { kind: 'add', username: person.username, permission: person.permission },
      {
        onSuccess: () => {
          setRemoved(null)
          announce(t('projects.share.hasAccessAgain', { name: displayName(person) }))
        },
      },
    )
  }

  return (
    <Dialog open onClose={onClose} labelledBy={titleId} returnFocusTo={returnFocusTo} className="w-[460px] max-w-[calc(100%-2rem)]">
      <div className="p-5">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: normalizeHex(project.hex_color) || 'var(--text-secondary)' }} />
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-card-title text-text">
            {t('projects.share.title', { title: project.title })}
          </h2>
          <button type="button" aria-label={t('projects.share.close')} onClick={onClose} className="inline-flex rounded-control p-1 text-text-secondary hover:bg-bg-hover hover:text-text">
            <X className="h-[15px] w-[15px]" aria-hidden="true" />
          </button>
        </div>
        <p className="mb-3.5 mt-2 text-meta leading-[19px] text-text-secondary [text-wrap:pretty]">
          {t('projects.share.intro')}
        </p>
        {isInbox && (
          <p className="-mt-1.5 mb-3.5 text-meta leading-[19px] text-text [text-wrap:pretty]">
            {t('projects.share.inboxWarning')}
          </p>
        )}

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            add()
          }}
        >
          <label htmlFor={usernameId} className="sr-only">
            {t('projects.share.username')}
          </label>
          <input
            id={usernameId}
            data-autofocus
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder={t('projects.share.username')}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={statusId}
            className={`${INPUT} h-8 min-w-0 flex-1`}
          />
          <select
            aria-label={t('projects.share.permission')}
            value={permission}
            onChange={(event) => setPermission(Number(event.target.value))}
            className={`${INPUT} h-8 w-[104px] px-2`}
          >
            {PERMISSIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {t(p.labelKey)}
              </option>
            ))}
          </select>
          <Button variant="primary" type="submit" disabled={!canShare} className="h-8">
            {t('projects.share.share')}
          </Button>
        </form>
        <p id={statusId} aria-live="polite" className="mt-1.5 min-h-[18px] text-meta text-text-secondary">
          {status}
        </p>

        <ul aria-label={t('projects.share.people')} className="mt-1.5 border-t border-[var(--border-color)]">
          {owner && <MemberRow person={owner} me={me?.id} note={t('projects.share.owner')} />}
          {users
            .filter((u) => u.id !== owner?.id)
            .map((user) => (
              <MemberRow key={`u-${user.id}`} person={user} me={me?.id}>
                <select
                  aria-label={t('projects.share.permissionFor', { name: displayName(user) })}
                  value={user.permission}
                  onChange={(event) => share.mutate({ kind: 'update', username: user.username, permission: Number(event.target.value) })}
                  className={`${INPUT} h-7 w-[104px] px-2`}
                >
                  {PERMISSIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {t(p.labelKey)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label={t('projects.share.remove', { name: displayName(user) })}
                  onClick={() => remove(user)}
                  className="inline-flex rounded-control p-1 text-text-secondary hover:bg-bg-hover hover:text-text"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </MemberRow>
            ))}
          {removed && !users.some((u) => u.id === removed.id) && (
            <li className="flex min-h-11 items-center gap-2.5 border-b border-[var(--border-color)]">
              <span className="min-w-0 flex-1 truncate text-meta text-text-secondary">{t('projects.share.removed', { name: displayName(removed) })}</span>
              <Button variant="quiet" onClick={undoRemove} disabled={share.isPending}>
                {t('projects.share.undo')}
              </Button>
            </li>
          )}
          {teams.map((team) => (
            <li key={`t-${team.id}`} className="flex min-h-11 items-center gap-2.5 border-b border-[var(--border-color)]">
              <span aria-hidden="true" className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-bg-selected text-meta font-semibold text-accent-blue">
                {Array.from(team.name)[0]?.toUpperCase() ?? '?'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-task-title text-text">{team.name}</div>
                <div className="text-meta text-text-secondary">{t('projects.share.team', { permission: t(PERMISSIONS.find((p) => p.value === team.permission)?.labelKey ?? 'projects.share.canView') })}</div>
              </div>
            </li>
          ))}
          {isLoading && <li className="py-3 text-meta text-text-secondary">{t('projects.share.loading')}</li>}
          {isError && <li className="py-3 text-meta text-text-secondary">{t('projects.share.loadFailed')}</li>}
        </ul>

        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t('projects.share.done')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function MemberRow({ person, me, note, children }: { person: PersonRef; me: number | undefined; note?: string; children?: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <li className="flex min-h-11 items-center gap-2.5 border-b border-[var(--border-color)]">
      <Avatar person={person} size={26} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-task-title text-text">
          {displayName(person)}
          {person.id === me && <span className="text-text-secondary"> {t('projects.share.you')}</span>}
        </div>
        <div className="truncate text-meta text-text-secondary">@{person.username}</div>
      </div>
      {note && <span className="pr-[26px] text-meta text-text-secondary">{note}</span>}
      {children}
    </li>
  )
}
