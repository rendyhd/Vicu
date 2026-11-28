import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import { useCollabMe, useProjectAccess, useProjectAccessMap } from '@/hooks/use-project-access'
import { useMembersPermissions } from '@/hooks/use-project-shares'
import { useProjects } from '@/hooks/use-projects'
import { displayName, visibleToText } from '@/lib/collaboration'
import {
  SHARE_ROUTINE_EXPLANATION,
  defaultShareProject,
  eligibleShareProjects,
  keepInChoices,
  routineSharing,
  sharePeople,
  sharedByText,
  sharedWithText,
  type RoutineSharing,
} from '@/lib/routine-sharing'
import { isSharedRoutine, type RoutineCarrier } from '@/lib/routines'
import type { Task } from '@/lib/vikunja-types'
import { cn } from '@/lib/cn'

// The "Share with" part of the routine editor and the shared marks of the lists (cross-app semantics
// section 6.9). A routine is shared through a project the user already shares with that person;
// nothing here creates or shares a project.

/** What saving the editor does about sharing. */
export type RoutineShareChoice =
  | { kind: 'keep' }
  | { kind: 'share'; projectId: number }
  | { kind: 'private' }

/** How this account sees a routine: whose it is, whether it is shared now, whether it can tick it. */
export function useRoutineSharing(carrier: RoutineCarrier<Task>): RoutineSharing {
  const me = useCollabMe()
  const access = useProjectAccess(carrier.task.project_id)
  return useMemo(() => routineSharing(carrier, access, me?.id), [carrier, access, me])
}

/** "Shared with Maya" (your routine) or "Shared by Maya" (someone else's); nothing for a private one. */
export function SharedRoutineLabel({ sharing, className }: { sharing: RoutineSharing; className?: string }) {
  const text = !sharing.shared ? '' : sharing.own ? sharedWithText(sharing.others) : sharing.owner ? sharedByText(sharing.owner) : ''
  if (!text) return null
  return <span className={cn('truncate text-meta text-[var(--text-secondary)]', className)}>{text}</span>
}

const LABEL = 'text-caption uppercase tracking-wide text-[var(--text-secondary)]'
const SELECT = 'h-9 w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] transition'

/**
 * The editor's "Share with": for your own routine (or a new one) a choice of the people you share an
 * eligible project with; for someone else's routine, who shared it. `onChange` gets what saving
 * should do, or null while a project still has to be picked ("Keep in", Save waits).
 */
export function RoutineShareField({
  carrier,
  onChange,
}: {
  carrier?: RoutineCarrier<Task>
  onChange: (choice: RoutineShareChoice | null) => void
}) {
  const { t } = useTranslation()
  const me = useCollabMe()
  const myId = me?.id
  const accessMap = useProjectAccessMap()
  const { data: projects } = useProjects()
  const currentProjectId = carrier?.task.project_id
  const sharing = useMemo(
    () => (carrier ? routineSharing(carrier, accessMap.get(carrier.task.project_id), myId) : null),
    [carrier, accessMap, myId],
  )
  const eligible = useMemo(() => eligibleShareProjects(projects?.active ?? [], accessMap, myId), [projects, accessMap, myId])
  const permissionOf = useMembersPermissions(eligible.map((project) => project.id), eligible.length > 0)
  const people = useMemo(() => sharePeople(eligible, myId, permissionOf), [eligible, myId, permissionOf])

  const initialPerson = sharing?.shared
    ? people.find((entry) => entry.canWrite && sharing.others.some((other) => other.id === entry.person.id) && entry.projects.some((p) => p.id === currentProjectId))?.person.id ?? null
    : null
  const [personId, setPersonId] = useState<number | null | undefined>(undefined)
  const [keepIn, setKeepIn] = useState<number | null | undefined>(undefined)
  const chosenPersonId = personId === undefined ? initialPerson : personId
  const chosen = people.find((entry) => entry.person.id === chosenPersonId) ?? null
  const chosenProjectId = !chosen ? null : keepIn === undefined ? defaultShareProject(chosen, currentProjectId) : keepIn
  const choices = chosen ? keepInChoices(chosen, currentProjectId) : []
  const chosenProject = choices.find((project) => project.id === chosenProjectId) ?? null
  const infoId = useId()
  const fieldId = useId()
  const [showInfo, setShowInfo] = useState(false)

  const report = (nextPerson: number | null, nextProject: number | null) => {
    const wasShared = !!carrier && isSharedRoutine(carrier.payload)
    if (nextPerson === null) onChange(wasShared ? { kind: 'private' } : { kind: 'keep' })
    else if (nextProject === null) onChange(null)
    else if (wasShared && nextProject === currentProjectId) onChange({ kind: 'keep' })
    else onChange({ kind: 'share', projectId: nextProject })
  }

  if (sharing && !sharing.own) {
    // Someone else's routine: only its owner shares, moves or stops it.
    return (
      <div>
        <div className={cn(LABEL, 'mb-1.5')}>{t('routines.sharing.shareWith')}</div>
        <p className="text-sm text-[var(--text-primary)]">{sharing.owner ? sharedByText(sharing.owner) : t('routines.sharing.sharedWithYou')}</p>
        {sharing.shared && <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{visibleToText([...(accessMap.get(currentProjectId ?? 0)?.members ?? [])], myId)}</p>}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <label htmlFor={fieldId} className={LABEL}>{t('routines.sharing.shareWith')}</label>
        <button
          type="button"
          aria-label={t('routines.sharing.about')}
          aria-expanded={showInfo}
          aria-controls={infoId}
          onClick={() => setShowInfo(!showInfo)}
          className="rounded-control p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </div>
      {showInfo && <p id={infoId} className="mb-2 rounded-card bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)]">{SHARE_ROUTINE_EXPLANATION}</p>}
      <select
        id={fieldId}
        className={SELECT}
        value={chosenPersonId ?? ''}
        onChange={(event) => {
          const next = event.target.value === '' ? null : Number(event.target.value)
          setPersonId(next)
          setKeepIn(undefined)
          const person = people.find((entry) => entry.person.id === next)
          report(next, person ? defaultShareProject(person, currentProjectId) : null)
        }}
      >
        <option value="">{t('routines.sharing.onlyYou')}</option>
        {people.map((entry) => (
          <option key={entry.person.id} value={entry.person.id} disabled={!entry.canWrite}>
            {entry.canWrite ? displayName(entry.person) : t('routines.sharing.canViewOnly', { name: displayName(entry.person) })}
          </option>
        ))}
      </select>
      {chosen && choices.length > 1 && (
        <fieldset className="mt-3">
          <legend className={cn(LABEL, 'mb-1.5')}>{t('routines.sharing.keepIn')}</legend>
          <div className="space-y-1.5">
            {choices.map((project) => (
              <label key={project.id} className={cn('flex cursor-pointer items-start gap-2 rounded-card border p-2.5', chosenProjectId === project.id ? 'border-accent-blue bg-accent-blue/10' : 'border-[var(--border-color)]')}>
                <input
                  type="radio"
                  name={`${fieldId}-keep-in`}
                  className="mt-0.5"
                  checked={chosenProjectId === project.id}
                  onChange={() => { setKeepIn(project.id); report(chosen.person.id, project.id) }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                    <span className="truncate">{project.title}</span>
                    {project.ownedByMe && <span className="shrink-0 text-caption text-[var(--text-secondary)]">{t('routines.sharing.yours')}</span>}
                  </span>
                  <span className="block text-xs text-[var(--text-secondary)]">{visibleToText([...project.members], myId)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {chosen && chosenProject && (
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          {visibleToText([...chosenProject.members], myId)}
          {choices.length === 1 && <> · {t('routines.sharing.keptIn', { title: chosenProject.title })}</>}
        </p>
      )}
    </div>
  )
}
