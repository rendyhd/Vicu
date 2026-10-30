import { Checkbox } from '@/components/shared/Checkbox'
import { useId, useMemo, useState } from 'react'
import { formatDateChip, formatMinutesOfDay } from '@/lib/date-utils'
import { useDateFormat } from '@/hooks/use-date-format'
import { ListSectionHeader } from '@/components/task-list/ListSectionHeader'
import {
  Archive,
  Bell,
  BellOff,
  Check,
  EyeOff,
  ChevronRight,
  Download,
  HeartPulse,
  History,
  Plus,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { RoutineTodaySection } from '@/components/routines/RoutineTodaySection'
import { SmartListIcon } from '@/components/shared/SmartListIcon'
import { PageHeader } from '@/components/shared/PageHeader'
import { ReadingScroll } from '@/components/layout/ReadingScroll'
import { Button } from '@/components/shared/Button'
import { Dialog } from '@/components/overlay/Dialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { useRoutineHistory, useRoutines, type RoutineDraft } from '@/hooks/use-routines'
import {
  csvForRoutines,
  localDateString,
  newId,
  scheduleSummary,
  timeLabel,
  type RoutineCarrier,
  MAX_ROUTINE_TIMES,
  type RoutineSlot,
} from '@/lib/routines'
import { isRoutinesEnabled, type Task } from '@/lib/vikunja-types'
import { useAppConfig } from '@/hooks/use-app-config'
import { cn } from '@/lib/cn'
import { parseTaskDuration } from '@/lib/task-duration'
import { RoutineShareField, SharedRoutineLabel, useRoutineSharing, type RoutineShareChoice } from '@/components/routines/RoutineSharing'
import { useCollabMe, useProjectAccess } from '@/hooks/use-project-access'
import { useSetSyncedPreference, useSyncedPrefs } from '@/hooks/use-synced-prefs'
import { loggedByText } from '@/lib/routine-sharing'
import { routineHiddenKey, routineRemindersKey, routineRemindersOn } from '../../shared/synced-prefs'

const FIELD = 'h-9 w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] transition'
const LABEL = 'mb-1.5 block text-caption uppercase tracking-wide text-[var(--text-secondary)]'
// Stored data, not theme colours: a routine saves the hex it was given (definition.color), so these
// values are fixed here and must not follow the palette roles or the theme.
const STORED_ROUTINE_COLORS = ['#AF52DE', '#007AFF', '#34C759', '#FF9500', '#FF3B30', '#5AC8FA']
const WEEKDAYS = [
  { id: 1, label: 'M' }, { id: 2, label: 'T' }, { id: 3, label: 'W' },
  { id: 4, label: 'T' }, { id: 5, label: 'F' }, { id: 6, label: 'S' }, { id: 7, label: 'S' },
]

/** A new time: an hour after the latest one, 09:00 for the first. Label and period are set on save. */
function newSlot(after?: number): RoutineSlot {
  const minutes = after === undefined ? 9 * 60 : Math.min(after + 60, 23 * 60 + 59)
  return { id: newId(), label: '', period: 'MORNING', reminderMinutes: minutes, reminderEnabled: true, followUpMinutes: 0 }
}

function emptyDraft(): RoutineDraft {
  const today = localDateString()
  return {
    name: '',
    iconName: '',
    color: STORED_ROUTINE_COLORS[0],
    schedule: { type: 'calendar', weekdays: [], weekInterval: 1, anchorDate: today },
    slots: [newSlot()],
    durationMinutes: null,
  }
}

function draftFor(carrier: RoutineCarrier<Task>): RoutineDraft {
  const { definition } = carrier.payload
  return {
    name: definition.name,
    iconName: definition.iconName,
    color: definition.color,
    schedule: definition.schedule,
    slots: definition.slots.map((slot) => ({ ...slot })),
    durationMinutes: parseTaskDuration(carrier.task.description),
  }
}

/** A routine dialog on the Dialog primitive: modal, Escape and the backdrop close it, focus returns to the opener. */
function DialogFrame({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const titleId = useId()
  return (
    <Dialog open onClose={onClose} labelledBy={titleId} className="w-[calc(100%-3rem)] max-w-xl">
      <div className="flex max-h-[88vh] flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center border-b border-[var(--border-color)] px-5">
          <h2 id={titleId} className="flex-1 text-base font-semibold text-[var(--text-primary)]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-control p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
            <X className="h-4 w-4" />
          </button>
        </header>
        {children}
      </div>
    </Dialog>
  )
}

function RoutineEditor({
  carrier,
  busy,
  onSave,
  onClose,
}: {
  carrier?: RoutineCarrier<Task>
  busy: boolean
  onSave: (draft: RoutineDraft, share: RoutineShareChoice) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<RoutineDraft>(() => carrier ? draftFor(carrier) : emptyDraft())
  // What saving does about sharing; null while "Keep in" still needs a choice (section 6.9).
  const [share, setShare] = useState<RoutineShareChoice | null>({ kind: 'keep' })
  const updateSlot = (id: string, patch: Partial<RoutineSlot>) => setDraft((current) => ({
    ...current,
    slots: current.slots.map((slot) => slot.id === id ? { ...slot, ...patch } : slot),
  }))
  const calendar = draft.schedule.type === 'calendar' ? draft.schedule : null
  const afterCompletion = draft.schedule.type === 'after_completion' ? draft.schedule : null

  return (
    <DialogFrame title={carrier ? 'Edit routine' : 'New routine'} onClose={onClose}>
      <form className="overflow-y-auto" onSubmit={(event) => { event.preventDefault(); if (share) onSave(draft, share) }}>
        <div className="space-y-5 p-5">
          <div>
            <label className={LABEL}>Name</label>
            <input data-autofocus className={FIELD} value={draft.name} placeholder="Take vitamins" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </div>

          <div>
            <label className={LABEL}>Color</label>
            <div className="flex gap-2">
              {STORED_ROUTINE_COLORS.map((color) => (
                <button key={color} type="button" onClick={() => setDraft({ ...draft, color })} className={cn('h-7 w-7 rounded-full transition-transform hover:scale-110 motion-reduce:hover:scale-100', draft.color === color && 'ring-2 ring-offset-2 ring-offset-[var(--bg-primary)]')} style={{ backgroundColor: color, color }} aria-label={`Use ${color}`} />
              ))}
            </div>
          </div>

          <div>
            <label className={LABEL}>Schedule</label>
            {(
              <div className="mb-2 flex gap-2">
                <button type="button" onClick={() => setDraft({ ...draft, schedule: { type: 'calendar', weekdays: [], weekInterval: 1, anchorDate: localDateString() } })} className={cn('rounded-control border px-3 py-1.5 text-xs font-medium', calendar ? 'border-accent-blue bg-accent-blue/10 text-accent-blue' : 'border-[var(--border-color)] text-[var(--text-secondary)]')}>On a schedule</button>
                <button type="button" onClick={() => setDraft({ ...draft, schedule: { type: 'after_completion', intervalDays: 14, firstDueDate: localDateString() } })} className={cn('rounded-control border px-3 py-1.5 text-xs font-medium', !calendar ? 'border-accent-blue bg-accent-blue/10 text-accent-blue' : 'border-[var(--border-color)] text-[var(--text-secondary)]')}>After completion</button>
              </div>
            )}
            <p className="mb-3 text-xs text-[var(--text-secondary)]">
              {calendar
                ? 'Repeats on the days you pick, whether or not you did it last time.'
                : 'Comes back a set number of days after you complete it.'}
            </p>
            {calendar ? (
              <div className="space-y-3 rounded-card border border-[var(--border-color)] p-3">
                <div className="flex gap-1.5">
                  {WEEKDAYS.map((day) => {
                    const selected = calendar.weekdays.includes(day.id)
                    return (
                      <button key={day.id} type="button" onClick={() => setDraft({ ...draft, schedule: { ...calendar, weekdays: selected ? calendar.weekdays.filter((id) => id !== day.id) : [...calendar.weekdays, day.id].sort() } })} className={cn('h-8 w-8 rounded-full text-xs font-semibold', selected ? 'bg-accent-fill text-on-accent' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]')}>{day.label}</button>
                    )
                  })}
                  <button type="button" onClick={() => setDraft({ ...draft, schedule: { ...calendar, weekdays: [] } })} className={cn('ml-1 rounded-control px-2 text-xs', calendar.weekdays.length === 0 ? 'bg-accent-blue/10 text-accent-blue' : 'text-[var(--text-secondary)]')}>Daily</button>
                </div>
                <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  Repeat
                  <select className="h-8 rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 text-[var(--text-primary)]" value={calendar.weekInterval} onChange={(event) => setDraft({ ...draft, schedule: { ...calendar, weekInterval: Number(event.target.value) } })}>
                    <option value={1}>every week</option>
                    <option value={2}>every 2 weeks</option>
                    <option value={3}>every 3 weeks</option>
                    <option value={4}>every 4 weeks</option>
                  </select>
                </label>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-card border border-[var(--border-color)] p-3 text-xs text-[var(--text-secondary)]">
                Show again
                <input type="number" min={1} max={365} className="h-8 w-20 rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 text-[var(--text-primary)]" value={afterCompletion?.intervalDays ?? 14} onChange={(event) => afterCompletion && setDraft({ ...draft, schedule: { ...afterCompletion, intervalDays: Math.max(1, Number(event.target.value)) } })} />
                days after I complete it
              </div>
            )}
          </div>

          <RoutineShareField carrier={carrier} onChange={setShare} />

          <div>
            <div className="mb-2 flex items-center">
              <label className="flex-1 text-caption uppercase tracking-wide text-[var(--text-secondary)]">Times & reminders</label>
              {draft.slots.length < MAX_ROUTINE_TIMES && <button type="button" onClick={() => setDraft({ ...draft, slots: [...draft.slots, newSlot(Math.max(...draft.slots.map((slot) => slot.reminderMinutes)))] })} className="flex items-center gap-1 text-xs font-medium text-accent-blue"><Plus className="h-3.5 w-3.5" /> Add time</button>}
            </div>
            <label className="mb-1.5 flex items-center gap-2 text-xs text-text-secondary">
              Duration
              <input
                type="number"
                min={1}
                step={1}
                placeholder="Optional"
                className="h-8 w-24 rounded-control border border-border bg-bg-page px-2 text-text"
                value={draft.durationMinutes ?? ''}
                onChange={(event) => setDraft({ ...draft, durationMinutes: event.target.value === '' ? null : Number(event.target.value) })}
              />
              minutes per time
            </label>
            <p className="mb-3 text-meta text-text-secondary">Set a duration to show this routine in the Planner calendar. Leave blank to hide it.</p>
            <div className="space-y-2">
              {draft.slots.map((slot) => (
                <div key={slot.id} className="rounded-card border border-[var(--border-color)] p-3">
                  <div className="flex items-center gap-2">
 <input type="time" aria-label="Time" className="h-8 rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 text-xs text-[var(--text-primary)]" value={timeLabel(slot.reminderMinutes)} onChange={(event) => { const [hours, minutes] = event.target.value.split(':').map(Number); updateSlot(slot.id, { reminderMinutes: hours * 60 + minutes }) }} />
                    <span className="flex-1" />
                    {draft.slots.length > 1 && <button type="button" aria-label="Remove time" onClick={() => setDraft({ ...draft, slots: draft.slots.filter((item) => item.id !== slot.id) })} className="p-1 text-[var(--text-secondary)] hover:text-danger"><X className="h-4 w-4" /></button>}
                  </div>
                  <div className="mt-2 flex items-center gap-4">
                    <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"><Checkbox checked={slot.reminderEnabled} onChange={(event) => updateSlot(slot.id, { reminderEnabled: event.target.checked })} /><Bell className="h-3.5 w-3.5" /> Remind me</label>
                    {slot.reminderEnabled && <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">Follow up<select className="h-7 rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-1 text-[var(--text-primary)]" value={slot.followUpMinutes} onChange={(event) => updateSlot(slot.id, { followUpMinutes: Number(event.target.value) })}><option value={0}>Off</option><option value={15}>15 min</option><option value={30}>30 min</option><option value={60}>1 hour</option></select></label>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
          <button type="button" onClick={onClose} className="rounded-control border border-[var(--border-color)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">Cancel</button>
          <button type="submit" disabled={busy || !draft.name.trim() || draft.slots.length === 0 || share === null} className="rounded-control bg-accent-fill px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50">{busy ? 'Saving...' : carrier ? 'Save changes' : 'Create routine'}</button>
        </footer>
      </form>
    </DialogFrame>
  )
}

function HistoryDialog({ carrier, onClose }: { carrier: RoutineCarrier<Task>; onClose: () => void }) {
  const dateFormat = useDateFormat()
  const sharing = useRoutineSharing(carrier)
  const me = useCollabMe()
  const members = useProjectAccess(carrier.task.project_id).members
  const { records, loadingArchive, archiveError } = useRoutineHistory(carrier)
  const logged = records.filter((record) => record.status !== 'PENDING')
  const completed = logged.filter((record) => record.status === 'COMPLETED').length
  const adherence = logged.length ? Math.round((completed / logged.length) * 100) : 0
  return (
    <DialogFrame title={carrier.payload.definition.name} onClose={onClose}>
      <div className="overflow-y-auto p-5">
        <div className="mb-5 grid grid-cols-2 gap-3">
          <div className="rounded-card bg-[var(--bg-secondary)] p-4"><div className="text-2xl font-semibold text-[var(--text-primary)]">{adherence}%</div><div className="text-xs text-[var(--text-secondary)]">Logged adherence</div></div>
          <div className="rounded-card bg-[var(--bg-secondary)] p-4"><div className="text-2xl font-semibold text-[var(--text-primary)]">{completed}</div><div className="text-xs text-[var(--text-secondary)]">Completions</div></div>
        </div>
        <h3 className="mb-2 text-caption uppercase tracking-wide text-[var(--text-secondary)]">History</h3>
        {loadingArchive && <p className="mb-2 text-xs text-[var(--text-secondary)]">Loading earlier history...</p>}
        {archiveError && <p className="mb-2 text-xs text-danger">Could not load earlier history: {archiveError}</p>}
        {records.length === 0 ? <p className="py-8 text-center text-sm text-[var(--text-secondary)]">No check-ins yet.</p> : (
          <div className="divide-y divide-[var(--border-color)]">
            {records.slice(0, 100).map((record) => (
              <div key={record.key} className="flex items-center gap-3 py-2.5">
                <div className={cn('flex h-6 w-6 items-center justify-center rounded-full', record.status === 'COMPLETED' ? 'bg-status-done/15 text-status-done' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]')}>
                  {record.status === 'COMPLETED' ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                </div>
                <div className="min-w-0 flex-1"><div className="text-sm text-[var(--text-primary)]">{formatDateChip(new Date(`${record.scheduledDate}T12:00:00`), true, new Date(), dateFormat)}</div><div className="text-meta text-[var(--text-secondary)]">{formatMinutesOfDay(record.scheduledMinutes, dateFormat)}</div></div>
                {sharing.shared && loggedByText(record.status, record, me?.id, members) && <span className="text-meta text-[var(--text-secondary)]">{loggedByText(record.status, record, me?.id, members)}</span>}
                <span className="text-meta capitalize text-[var(--text-secondary)]">{record.status.toLowerCase().replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </DialogFrame>
  )
}

export function RoutinesView() {
  const { data: config } = useAppConfig()
  // The sidebar hides Routines when they are off; a route kept from before (history, a link) lands here.
  if (config && !isRoutinesEnabled(config)) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 bg-[var(--bg-primary)] px-6 text-center">
        <HeartPulse className="h-8 w-8 text-[var(--text-tertiary)]" />
        <p className="text-sm font-medium text-[var(--text-primary)]">Routines are turned off</p>
        <p className="text-xs text-[var(--text-secondary)]">Turn them on in Settings to keep track of what you do regularly.</p>
      </div>
    )
  }
  return <RoutinesContent />
}

function RoutinesContent() {
  const routines = useRoutines()
  const [editor, setEditor] = useState<RoutineCarrier<Task> | 'new' | null>(null)
  const [history, setHistory] = useState<RoutineCarrier<Task> | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const active = useMemo(() => routines.active, [routines.active])

  const [exportError, setExportError] = useState<string | null>(null)

  /** Saves the editor: the routine, then what changed about sharing (section 6.9). */
  const save = async (target: RoutineCarrier<Task> | 'new', draft: RoutineDraft, share: RoutineShareChoice) => {
    try {
      if (target === 'new') {
        await routines.createRoutine.mutateAsync({ ...draft, shareProjectId: share.kind === 'share' ? share.projectId : undefined })
      } else {
        const saved = await routines.updateRoutine.mutateAsync({ carrier: target, draft })
        if (share.kind === 'share') await routines.shareRoutine.mutateAsync({ carrier: saved, projectId: share.projectId })
        else if (share.kind === 'private') await routines.stopSharingRoutine.mutateAsync(saved)
      }
      setEditor(null)
    } catch {
      // The error banner below shows what went wrong; the editor stays open with the draft.
    }
  }

  const exportCsv = async () => {
    setExportError(null)
    try {
      // The archive is read on demand: the export includes history older than the rolling window.
      const entries = await routines.loadCsvEntries()
      const blob = new Blob([csvForRoutines(entries)], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `vicu-routines-${localDateString()}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Could not export routines')
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-[var(--bg-primary)]">
      <PageHeader
        title="Routines"
        subtitle="What you do regularly, day by day"
        icon={<SmartListIcon list="routines" className="h-5 w-5" />}
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv} disabled={routines.carriers.length === 0}><Download className="h-4 w-4" /> Export</Button>
            <Button variant="primary" onClick={() => setEditor('new')}><Plus className="h-4 w-4" /> New routine</Button>
          </>
        }
      />

      <ReadingScroll columnClassName="pb-10">
        <div>
          <RoutineTodaySection showEmpty />

          <section className="px-6 pt-6">
            <ListSectionHeader level={1} title="Your routines" count={active.length} sticky={false} className="mb-3 px-0" />
            {routines.isLoading && <div className="rounded-card border border-[var(--border-color)] p-8 text-center text-sm text-[var(--text-secondary)]">Loading routines...</div>}
            {!routines.isLoading && active.length === 0 && (
              <EmptyState
                icon={Plus}
                identity="routines"
                title="Create your first routine"
                subtitle="Track what you do regularly, like taking vitamins or watering the plants, without turning it into an endless pile of recurring tasks."
                className="py-10"
                action={<Button variant="secondary" onClick={() => setEditor('new')}><Plus className="h-4 w-4" /> Create routine</Button>}
              />
            )}
            <div className="space-y-2">
              {active.map((carrier) => (
                <RoutineCard
                  key={carrier.payload.definition.id}
                  carrier={carrier}
                  onHistory={() => setHistory(carrier)}
                  onEdit={() => setEditor(carrier)}
                  onArchive={() => routines.archiveRoutine.mutate({ carrier, archived: true })}
                />
              ))}
            </div>
          </section>

          {routines.archived.length > 0 && (
            <section className="px-6 pt-7">
              <button type="button" onClick={() => setShowArchived(!showArchived)} aria-expanded={showArchived} className="mb-3 flex h-8 w-full items-center gap-2 text-left text-section text-text"><span>Archived</span><span className="font-medium tabular-nums text-text-secondary">{routines.archived.length}</span></button>
              {showArchived && <div className="space-y-2">{routines.archived.map((carrier) => <ArchivedRoutineRow key={carrier.payload.definition.id} carrier={carrier} onRestore={() => routines.archiveRoutine.mutate({ carrier, archived: false })} onDelete={() => { if (window.confirm(`Permanently delete "${carrier.payload.definition.name}" and its history?`)) routines.deleteRoutine.mutate(carrier) }} />)}</div>}
            </section>
          )}

          {routines.updateRequired > 0 && <div className="mx-6 mt-5 rounded-card border border-status-today/30 bg-status-today/10 px-4 py-3 text-xs text-status-today">Update required: {routines.updateRequired === 1 ? 'a routine was' : `${routines.updateRequired} routines were`} saved by a newer version of Vicu. Update Vicu to see and change {routines.updateRequired === 1 ? 'it' : 'them'}.</div>}
          {routines.unreadable > 0 && <div className="mx-6 mt-5 rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger">{routines.unreadable === 1 ? 'A routine record cannot be read and is' : `${routines.unreadable} routine records cannot be read and are`} left out; nothing in {routines.unreadable === 1 ? 'it' : 'them'} was changed.</div>}
          {routines.archiveWarning && <div className="mx-6 mt-5 rounded-card border border-status-today/30 bg-status-today/10 px-4 py-3 text-xs text-status-today">Older history could not be archived yet and stays in the routine for now: {routines.archiveWarning}</div>}
          {exportError && <div className="mx-6 mt-5 rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger">{exportError}</div>}
          {routines.error && <div className="mx-6 mt-5 rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger">{routines.error instanceof Error ? routines.error.message : 'Could not update routines'}</div>}
        </div>
      </ReadingScroll>

      {editor && <RoutineEditor carrier={editor === 'new' ? undefined : editor} busy={routines.isMutating} onClose={() => setEditor(null)} onSave={(draft, share) => { void save(editor, draft, share) }} />}
      {history && <HistoryDialog carrier={history} onClose={() => setHistory(null)} />}
    </div>
  )
}

/** A routine in "Your routines": what you may do with it depends on whose it is (section 6.9). */
function RoutineCard({
  carrier,
  onHistory,
  onEdit,
  onArchive,
}: {
  carrier: RoutineCarrier<Task>
  onHistory: () => void
  onEdit: () => void
  onArchive: () => void
}) {
  const definition = carrier.payload.definition
  const sharing = useRoutineSharing(carrier)
  const { snapshot } = useSyncedPrefs()
  const setPref = useSetSyncedPreference()
  const remindersOn = routineRemindersOn(snapshot.values, definition.id)
  const member = sharing.shared && !sharing.own
  return (
    <article className="group flex items-center gap-3 rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-3.5 transition hover:border-[var(--text-tertiary)] hover:shadow-sm">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card text-white" style={{ backgroundColor: definition.color || STORED_ROUTINE_COLORS[0] }}><HeartPulse className="h-5 w-5" /></div>
      <button type="button" onClick={onHistory} className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{definition.name}</div>
        <div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{[scheduleSummary(definition), [...definition.slots].sort((left, right) => left.reminderMinutes - right.reminderMinutes).map((slot) => formatMinutesOfDay(slot.reminderMinutes)).join(', ')].filter(Boolean).join(' · ')}</div>
        <SharedRoutineLabel sharing={sharing} className="mt-0.5 block" />
      </button>
      <button type="button" title="History" onClick={onHistory} className="rounded-control p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><History className="h-4 w-4" /></button>
      {sharing.canWrite && <button type="button" title="Edit" onClick={onEdit} className="rounded-control p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><ChevronRight className="h-4 w-4" /></button>}
      {member && sharing.canWrite && (
        <button
          type="button"
          title={remindersOn ? 'Turn off my reminders' : 'Turn on my reminders'}
          aria-label={remindersOn ? 'Turn off my reminders' : 'Turn on my reminders'}
          onClick={() => setPref.mutate({ key: routineRemindersKey(definition.id), value: remindersOn ? 'off' : null })}
          className="rounded-control p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          {remindersOn ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        </button>
      )}
      {member && (
        <button type="button" title="Hide for me" aria-label="Hide for me" onClick={() => setPref.mutate({ key: routineHiddenKey(definition.id), value: true })} className="rounded-control p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><EyeOff className="h-4 w-4" /></button>
      )}
      {sharing.own && <button type="button" title="Archive" onClick={onArchive} className="rounded-control p-2 text-[var(--text-secondary)] opacity-0 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] group-hover:opacity-100"><Archive className="h-4 w-4" /></button>}
    </article>
  )
}

/** An archived routine: only its owner restores or deletes it (section 6.9). */
function ArchivedRoutineRow({ carrier, onRestore, onDelete }: { carrier: RoutineCarrier<Task>; onRestore: () => void; onDelete: () => void }) {
  const sharing = useRoutineSharing(carrier)
  return (
    <div className="flex items-center gap-3 rounded-card border border-[var(--border-color)] px-3 py-2.5">
      <Archive className="h-4 w-4 text-[var(--text-secondary)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-[var(--text-primary)]">{carrier.payload.definition.name}</span>
        <SharedRoutineLabel sharing={sharing} className="block" />
      </span>
      {sharing.own && <button type="button" onClick={onRestore} className="flex items-center gap-1 text-xs font-medium text-accent-blue"><Undo2 className="h-3.5 w-3.5" /> Restore</button>}
      {sharing.own && <button type="button" aria-label={`Delete ${carrier.payload.definition.name}`} onClick={onDelete} className="rounded-control p-1.5 text-[var(--text-secondary)] hover:bg-danger/10 hover:text-danger"><Trash2 className="h-4 w-4" /></button>}
    </div>
  )
}
