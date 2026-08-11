import { useMemo, useState } from 'react'
import {
  Archive,
  Bell,
  Check,
  ChevronRight,
  Download,
  HeartPulse,
  History,
  Home,
  Pill,
  Plus,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { RoutineTodaySection } from '@/components/routines/RoutineTodaySection'
import { useRoutineHistory, useRoutines, type RoutineDraft } from '@/hooks/use-routines'
import {
  csvForRoutines,
  isoWeekday,
  localDateString,
  newId,
  scheduleSummary,
  timeLabel,
  type RoutineCarrier,
  type RoutineKind,
  type RoutinePeriod,
  type RoutineSlot,
} from '@/lib/routines'
import type { Task } from '@/lib/vikunja-types'
import { cn } from '@/lib/cn'

const FIELD = 'h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-accent-blue'
const LABEL = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]'
const COLORS = ['#AF52DE', '#007AFF', '#34C759', '#FF9500', '#FF3B30', '#5AC8FA']
const WEEKDAYS = [
  { id: 1, label: 'M' }, { id: 2, label: 'T' }, { id: 3, label: 'W' },
  { id: 4, label: 'T' }, { id: 5, label: 'F' }, { id: 6, label: 'S' }, { id: 7, label: 'S' },
]

function defaultSlot(kind: RoutineKind, index = 0): RoutineSlot {
  const presets = [
    { label: 'Morning', period: 'MORNING' as RoutinePeriod, minutes: 8 * 60 },
    { label: 'Afternoon', period: 'AFTERNOON' as RoutinePeriod, minutes: 15 * 60 },
    { label: 'Evening', period: 'EVENING' as RoutinePeriod, minutes: 20 * 60 },
  ]
  const preset = presets[Math.min(index, presets.length - 1)]
  return kind === 'HEALTH'
    ? { id: newId(), label: preset.label, period: preset.period, reminderMinutes: preset.minutes, reminderEnabled: true, followUpMinutes: 30 }
    : { id: newId(), label: 'At home', period: 'HOME', reminderMinutes: 9 * 60, reminderEnabled: true, followUpMinutes: 60 }
}

function emptyDraft(kind: RoutineKind = 'HEALTH'): RoutineDraft {
  const today = localDateString()
  return {
    name: '',
    kind,
    healthSubtype: kind === 'HEALTH' ? 'SUPPLEMENT' : null,
    amount: '',
    unit: '',
    iconName: kind === 'HEALTH' ? 'pill' : 'home',
    color: kind === 'HEALTH' ? COLORS[0] : COLORS[2],
    schedule: { type: 'calendar', weekdays: kind === 'HEALTH' ? [] : [isoWeekday(today)], weekInterval: 1, anchorDate: today },
    slots: [defaultSlot(kind)],
  }
}

function draftFor(carrier: RoutineCarrier<Task>): RoutineDraft {
  const { definition } = carrier.payload
  return {
    name: definition.name,
    kind: definition.kind,
    healthSubtype: definition.healthSubtype,
    amount: definition.amount,
    unit: definition.unit,
    iconName: definition.iconName,
    color: definition.color,
    schedule: definition.schedule,
    slots: definition.slots.map((slot) => ({ ...slot })),
  }
}

function DialogFrame({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6" onMouseDown={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex h-14 shrink-0 items-center border-b border-[var(--border-color)] px-5">
          <h2 className="flex-1 text-base font-semibold text-[var(--text-primary)]">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
            <X className="h-4 w-4" />
          </button>
        </header>
        {children}
      </div>
    </div>
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
  onSave: (draft: RoutineDraft) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<RoutineDraft>(() => carrier ? draftFor(carrier) : emptyDraft())
  const updateSlot = (id: string, patch: Partial<RoutineSlot>) => setDraft((current) => ({
    ...current,
    slots: current.slots.map((slot) => slot.id === id ? { ...slot, ...patch } : slot),
  }))
  const setKind = (kind: RoutineKind) => setDraft((current) => {
    if (current.kind === kind) return current
    const fresh = emptyDraft(kind)
    return { ...fresh, name: current.name, color: fresh.color }
  })
  const calendar = draft.schedule.type === 'calendar' ? draft.schedule : null
  const afterCompletion = draft.schedule.type === 'after_completion' ? draft.schedule : null

  return (
    <DialogFrame title={carrier ? 'Edit routine' : 'New routine'} onClose={onClose}>
      <form className="overflow-y-auto" onSubmit={(event) => { event.preventDefault(); onSave(draft) }}>
        <div className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-[var(--bg-secondary)] p-1">
            {(['HEALTH', 'CHORE'] as RoutineKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setKind(kind)}
                className={cn('flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium transition', draft.kind === kind ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-secondary)]')}
              >
                {kind === 'HEALTH' ? <Pill className="h-4 w-4" /> : <Home className="h-4 w-4" />}
                {kind === 'HEALTH' ? 'Health' : 'Chore'}
              </button>
            ))}
          </div>

          <div>
            <label className={LABEL}>Name</label>
            <input autoFocus className={FIELD} value={draft.name} placeholder={draft.kind === 'HEALTH' ? 'Creatine' : 'Take out the trash'} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </div>

          {draft.kind === 'HEALTH' && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={LABEL}>Type</label>
                <select className={FIELD} value={draft.healthSubtype ?? 'SUPPLEMENT'} onChange={(event) => setDraft({ ...draft, healthSubtype: event.target.value as 'SUPPLEMENT' | 'MEDICATION' })}>
                  <option value="SUPPLEMENT">Supplement</option>
                  <option value="MEDICATION">Medication</option>
                </select>
              </div>
              <div>
                <label className={LABEL}>Amount</label>
                <input className={FIELD} value={draft.amount} placeholder="5" onChange={(event) => setDraft({ ...draft, amount: event.target.value })} />
              </div>
              <div>
                <label className={LABEL}>Unit</label>
                <input className={FIELD} value={draft.unit} placeholder="g" onChange={(event) => setDraft({ ...draft, unit: event.target.value })} />
              </div>
            </div>
          )}

          <div>
            <label className={LABEL}>Color</label>
            <div className="flex gap-2">
              {COLORS.map((color) => (
                <button key={color} type="button" onClick={() => setDraft({ ...draft, color })} className={cn('h-7 w-7 rounded-full transition-transform hover:scale-110', draft.color === color && 'ring-2 ring-offset-2 ring-offset-[var(--bg-primary)]')} style={{ backgroundColor: color, color }} aria-label={`Use ${color}`} />
              ))}
            </div>
          </div>

          <div>
            <label className={LABEL}>Schedule</label>
            {draft.kind === 'CHORE' && (
              <div className="mb-3 flex gap-2">
                <button type="button" onClick={() => setDraft({ ...draft, schedule: { type: 'calendar', weekdays: [isoWeekday(localDateString())], weekInterval: 1, anchorDate: localDateString() } })} className={cn('rounded-md border px-3 py-1.5 text-xs font-medium', calendar ? 'border-accent-blue bg-accent-blue/10 text-accent-blue' : 'border-[var(--border-color)] text-[var(--text-secondary)]')}>On a schedule</button>
                <button type="button" onClick={() => setDraft({ ...draft, schedule: { type: 'after_completion', intervalDays: 14, firstDueDate: localDateString() } })} className={cn('rounded-md border px-3 py-1.5 text-xs font-medium', !calendar ? 'border-accent-blue bg-accent-blue/10 text-accent-blue' : 'border-[var(--border-color)] text-[var(--text-secondary)]')}>After completion</button>
              </div>
            )}
            {calendar ? (
              <div className="space-y-3 rounded-lg border border-[var(--border-color)] p-3">
                <div className="flex gap-1.5">
                  {WEEKDAYS.map((day) => {
                    const selected = calendar.weekdays.includes(day.id)
                    return (
                      <button key={day.id} type="button" onClick={() => setDraft({ ...draft, schedule: { ...calendar, weekdays: selected ? calendar.weekdays.filter((id) => id !== day.id) : [...calendar.weekdays, day.id].sort() } })} className={cn('h-8 w-8 rounded-full text-xs font-semibold', selected ? 'bg-accent-blue text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]')}>{day.label}</button>
                    )
                  })}
                  <button type="button" onClick={() => setDraft({ ...draft, schedule: { ...calendar, weekdays: [] } })} className={cn('ml-1 rounded-md px-2 text-xs', calendar.weekdays.length === 0 ? 'bg-accent-blue/10 text-accent-blue' : 'text-[var(--text-secondary)]')}>Daily</button>
                </div>
                <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  Repeat
                  <select className="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 text-[var(--text-primary)]" value={calendar.weekInterval} onChange={(event) => setDraft({ ...draft, schedule: { ...calendar, weekInterval: Number(event.target.value) } })}>
                    <option value={1}>every week</option>
                    <option value={2}>every 2 weeks</option>
                    <option value={3}>every 3 weeks</option>
                    <option value={4}>every 4 weeks</option>
                  </select>
                </label>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-[var(--border-color)] p-3 text-xs text-[var(--text-secondary)]">
                Show again
                <input type="number" min={1} max={365} className="h-8 w-20 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 text-[var(--text-primary)]" value={afterCompletion?.intervalDays ?? 14} onChange={(event) => afterCompletion && setDraft({ ...draft, schedule: { ...afterCompletion, intervalDays: Math.max(1, Number(event.target.value)) } })} />
                days after I complete it
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center">
              <label className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Times & reminders</label>
              {draft.kind === 'HEALTH' && <button type="button" onClick={() => setDraft({ ...draft, slots: [...draft.slots, defaultSlot('HEALTH', draft.slots.length)] })} className="flex items-center gap-1 text-xs font-medium text-accent-blue"><Plus className="h-3.5 w-3.5" /> Add time</button>}
            </div>
            <div className="space-y-2">
              {draft.slots.map((slot) => (
                <div key={slot.id} className="rounded-lg border border-[var(--border-color)] p-3">
                  <div className="flex items-center gap-2">
                    <input className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 text-xs text-[var(--text-primary)]" value={slot.label} onChange={(event) => updateSlot(slot.id, { label: event.target.value })} />
                    <input type="time" className="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 text-xs text-[var(--text-primary)]" value={timeLabel(slot.reminderMinutes)} onChange={(event) => { const [hours, minutes] = event.target.value.split(':').map(Number); updateSlot(slot.id, { reminderMinutes: hours * 60 + minutes }) }} />
                    {draft.slots.length > 1 && <button type="button" onClick={() => setDraft({ ...draft, slots: draft.slots.filter((item) => item.id !== slot.id) })} className="p-1 text-[var(--text-secondary)] hover:text-accent-red"><X className="h-4 w-4" /></button>}
                  </div>
                  <div className="mt-2 flex items-center gap-4">
                    <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"><input type="checkbox" checked={slot.reminderEnabled} onChange={(event) => updateSlot(slot.id, { reminderEnabled: event.target.checked })} /><Bell className="h-3.5 w-3.5" /> Remind me</label>
                    {slot.reminderEnabled && <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">Follow up<select className="h-7 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-1 text-[var(--text-primary)]" value={slot.followUpMinutes} onChange={(event) => updateSlot(slot.id, { followUpMinutes: Number(event.target.value) })}><option value={0}>Off</option><option value={15}>15 min</option><option value={30}>30 min</option><option value={60}>1 hour</option></select></label>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
          <button type="button" onClick={onClose} className="rounded-md border border-[var(--border-color)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">Cancel</button>
          <button type="submit" disabled={busy || !draft.name.trim() || draft.slots.length === 0} className="rounded-md bg-accent-blue px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Saving...' : carrier ? 'Save changes' : 'Create routine'}</button>
        </footer>
      </form>
    </DialogFrame>
  )
}

function HistoryDialog({ carrier, onClose }: { carrier: RoutineCarrier<Task>; onClose: () => void }) {
  const records = useRoutineHistory(carrier)
  const logged = records.filter((record) => record.status !== 'PENDING')
  const completed = logged.filter((record) => record.status === 'COMPLETED').length
  const adherence = logged.length ? Math.round((completed / logged.length) * 100) : 0
  return (
    <DialogFrame title={carrier.payload.definition.name} onClose={onClose}>
      <div className="overflow-y-auto p-5">
        <div className="mb-5 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-[var(--bg-secondary)] p-4"><div className="text-2xl font-semibold text-[var(--text-primary)]">{adherence}%</div><div className="text-xs text-[var(--text-secondary)]">Logged adherence</div></div>
          <div className="rounded-lg bg-[var(--bg-secondary)] p-4"><div className="text-2xl font-semibold text-[var(--text-primary)]">{completed}</div><div className="text-xs text-[var(--text-secondary)]">Completions</div></div>
        </div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">History</h3>
        {records.length === 0 ? <p className="py-8 text-center text-sm text-[var(--text-secondary)]">No check-ins yet.</p> : (
          <div className="divide-y divide-[var(--border-color)]">
            {records.slice(0, 100).map((record) => (
              <div key={record.key} className="flex items-center gap-3 py-2.5">
                <div className={cn('flex h-6 w-6 items-center justify-center rounded-full', record.status === 'COMPLETED' ? 'bg-accent-green/15 text-accent-green' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]')}>
                  {record.status === 'COMPLETED' ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                </div>
                <div className="min-w-0 flex-1"><div className="text-sm text-[var(--text-primary)]">{new Date(`${record.scheduledDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div><div className="text-[11px] text-[var(--text-secondary)]">{timeLabel(record.scheduledMinutes)}</div></div>
                <span className="text-[11px] font-medium capitalize text-[var(--text-secondary)]">{record.status.toLowerCase().replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </DialogFrame>
  )
}

export function RoutinesView() {
  const routines = useRoutines()
  const [editor, setEditor] = useState<RoutineCarrier<Task> | 'new' | null>(null)
  const [history, setHistory] = useState<RoutineCarrier<Task> | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const active = useMemo(() => routines.active, [routines.active])

  const exportCsv = () => {
    const blob = new Blob([csvForRoutines(routines.carriers)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `vicu-routines-${localDateString()}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-[var(--bg-primary)]">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-[var(--border-color)] px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-purple/15 text-accent-purple"><HeartPulse className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1"><h1 className="text-xl font-semibold text-[var(--text-primary)]">Routines</h1><p className="text-xs text-[var(--text-secondary)]">Daily health and recurring home rhythms</p></div>
        <button type="button" onClick={exportCsv} disabled={routines.carriers.length === 0} className="flex h-9 items-center gap-2 rounded-md border border-[var(--border-color)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"><Download className="h-4 w-4" /> Export</button>
        <button type="button" onClick={() => setEditor('new')} className="flex h-9 items-center gap-2 rounded-md bg-accent-blue px-3 text-xs font-semibold text-white"><Plus className="h-4 w-4" /> New routine</button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-10">
        <div className="mx-auto max-w-3xl">
          <RoutineTodaySection showEmpty />

          <section className="px-6 pt-6">
            <div className="mb-3 flex items-center"><h2 className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Your routines</h2><span className="text-xs text-[var(--text-secondary)]">{active.length} active</span></div>
            {routines.isLoading && <div className="rounded-xl border border-[var(--border-color)] p-8 text-center text-sm text-[var(--text-secondary)]">Loading routines...</div>}
            {!routines.isLoading && active.length === 0 && (
              <button type="button" onClick={() => setEditor('new')} className="flex w-full flex-col items-center rounded-xl border border-dashed border-[var(--border-color)] px-6 py-10 text-center hover:bg-[var(--bg-hover)]"><div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-accent-purple/15 text-accent-purple"><Plus className="h-5 w-5" /></div><span className="text-sm font-semibold text-[var(--text-primary)]">Create your first routine</span><span className="mt-1 max-w-sm text-xs leading-5 text-[var(--text-secondary)]">Track supplements, medication, or chores without turning them into an endless pile of recurring tasks.</span></button>
            )}
            <div className="space-y-2">
              {active.map((carrier) => {
                const definition = carrier.payload.definition
                const Icon = definition.kind === 'HEALTH' ? Pill : Home
                return (
                  <article key={definition.id} className="group flex items-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3.5 transition hover:border-[var(--text-tertiary)] hover:shadow-sm">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ backgroundColor: definition.color || COLORS[0] }}><Icon className="h-5 w-5" /></div>
                    <button type="button" onClick={() => setHistory(carrier)} className="min-w-0 flex-1 text-left"><div className="truncate text-sm font-semibold text-[var(--text-primary)]">{definition.name}</div><div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{[definition.amount, definition.unit, scheduleSummary(definition)].filter(Boolean).join(' / ')}</div></button>
                    <button type="button" title="History" onClick={() => setHistory(carrier)} className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><History className="h-4 w-4" /></button>
                    <button type="button" title="Edit" onClick={() => setEditor(carrier)} className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><ChevronRight className="h-4 w-4" /></button>
                    <button type="button" title="Archive" onClick={() => routines.archiveRoutine.mutate({ carrier, archived: true })} className="rounded-md p-2 text-[var(--text-secondary)] opacity-0 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] group-hover:opacity-100"><Archive className="h-4 w-4" /></button>
                  </article>
                )
              })}
            </div>
          </section>

          {routines.archived.length > 0 && (
            <section className="px-6 pt-7">
              <button type="button" onClick={() => setShowArchived(!showArchived)} className="mb-3 flex w-full items-center text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]"><span className="flex-1">Archived</span><span>{routines.archived.length}</span></button>
              {showArchived && <div className="space-y-2">{routines.archived.map((carrier) => <div key={carrier.payload.definition.id} className="flex items-center gap-3 rounded-lg border border-[var(--border-color)] px-3 py-2.5"><Archive className="h-4 w-4 text-[var(--text-secondary)]" /><span className="flex-1 text-sm text-[var(--text-primary)]">{carrier.payload.definition.name}</span><button type="button" onClick={() => routines.archiveRoutine.mutate({ carrier, archived: false })} className="flex items-center gap-1 text-xs font-medium text-accent-blue"><Undo2 className="h-3.5 w-3.5" /> Restore</button><button type="button" onClick={() => { if (window.confirm(`Permanently delete "${carrier.payload.definition.name}" and its history?`)) routines.deleteRoutine.mutate(carrier) }} className="rounded-md p-1.5 text-[var(--text-secondary)] hover:bg-accent-red/10 hover:text-accent-red"><Trash2 className="h-4 w-4" /></button></div>)}</div>}
            </section>
          )}

          {routines.error && <div className="mx-6 mt-5 rounded-lg border border-accent-red/30 bg-accent-red/10 px-4 py-3 text-xs text-accent-red">{routines.error instanceof Error ? routines.error.message : 'Could not update routines'}</div>}
        </div>
      </div>

      {editor && <RoutineEditor carrier={editor === 'new' ? undefined : editor} busy={routines.isMutating} onClose={() => setEditor(null)} onSave={(draft) => editor === 'new' ? routines.createRoutine.mutate(draft, { onSuccess: () => setEditor(null) }) : routines.updateRoutine.mutate({ carrier: editor, draft }, { onSuccess: () => setEditor(null) })} />}
      {history && <HistoryDialog carrier={history} onClose={() => setHistory(null)} />}
    </div>
  )
}
