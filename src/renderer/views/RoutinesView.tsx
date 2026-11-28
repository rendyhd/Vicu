import { Checkbox } from '@/components/shared/Checkbox'
import { useId, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../shared/i18n'
import { formatDateChip, formatMinutesOfDay } from '@/lib/date-utils'
import { useDateFormat } from '@/hooks/use-date-format'
import { ListSectionHeader } from '@/components/task-list/ListSectionHeader'
import {
  Archive,
  Bell,
  BellOff,
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
import { RoutineShareField, SharedRoutineLabel, useRoutineSharing, type RoutineShareChoice } from '@/components/routines/RoutineSharing'
import { useCollabMe, useProjectAccess } from '@/hooks/use-project-access'
import { useSetSyncedPreference, useSyncedPrefs } from '@/hooks/use-synced-prefs'
import { loggedByText } from '@/lib/routine-sharing'
import { MonthCalendar, type DayMark } from '@/components/task-list/MonthCalendar'
import { routineTrend } from '../../shared/routine-trend'
import { routineHiddenKey, routineRemindersKey, routineRemindersOn } from '../../shared/synced-prefs'
import { useWeekStart } from '@/hooks/use-week-start'
import { weekdaysOf } from '../../shared/week-start'

const FIELD = 'h-9 w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] transition'
const LABEL = 'mb-1.5 block text-caption uppercase tracking-wide text-[var(--text-secondary)]'
// Stored data, not theme colours: a routine saves the hex it was given (definition.color), so these
// values are fixed here and must not follow the palette roles or the theme.
const STORED_ROUTINE_COLORS = ['#AF52DE', '#007AFF', '#34C759', '#FF9500', '#FF3B30', '#5AC8FA']
const WEEKDAYS: { id: number; label: TranslationKey }[] = [
  { id: 1, label: 'routines.weekdayInitials.monday' }, { id: 2, label: 'routines.weekdayInitials.tuesday' }, { id: 3, label: 'routines.weekdayInitials.wednesday' },
  { id: 4, label: 'routines.weekdayInitials.thursday' }, { id: 5, label: 'routines.weekdayInitials.friday' }, { id: 6, label: 'routines.weekdayInitials.saturday' }, { id: 7, label: 'routines.weekdayInitials.sunday' },
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
  }
}

/** A routine dialog on the Dialog primitive: modal, Escape and the backdrop close it, focus returns to the opener. */
function DialogFrame({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const { t } = useTranslation()
  const titleId = useId()
  return (
    <Dialog open onClose={onClose} labelledBy={titleId} className="w-[calc(100%-3rem)] max-w-xl">
      <div className="flex max-h-[88vh] flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center border-b border-[var(--border-color)] px-5">
          <h2 id={titleId} className="flex-1 text-base font-semibold text-[var(--text-primary)]">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t('routines.close')} className="rounded-control p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
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
  const { t } = useTranslation()
  const [draft, setDraft] = useState<RoutineDraft>(() => carrier ? draftFor(carrier) : emptyDraft())
  // The weekday buttons in the order of the account's week (contract section 2.1); what is saved is unchanged.
  const weekOrder = weekdaysOf(useWeekStart()).map((iso) => WEEKDAYS[iso - 1])
  // What saving does about sharing; null while "Keep in" still needs a choice (section 6.9).
  const [share, setShare] = useState<RoutineShareChoice | null>({ kind: 'keep' })
  const updateSlot = (id: string, patch: Partial<RoutineSlot>) => setDraft((current) => ({
    ...current,
    slots: current.slots.map((slot) => slot.id === id ? { ...slot, ...patch } : slot),
  }))
  const calendar = draft.schedule.type === 'calendar' ? draft.schedule : null
  const afterCompletion = draft.schedule.type === 'after_completion' ? draft.schedule : null

  return (
    <DialogFrame title={carrier ? t('routines.editor.editTitle') : t('routines.editor.newTitle')} onClose={onClose}>
      <form className="overflow-y-auto" onSubmit={(event) => { event.preventDefault(); if (share) onSave(draft, share) }}>
        <div className="space-y-5 p-5">
          <div>
            <label className={LABEL}>{t('routines.editor.name')}</label>
            <input data-autofocus className={FIELD} value={draft.name} placeholder={t('routines.editor.namePlaceholder')} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </div>

          <div>
            <label className={LABEL}>{t('routines.editor.color')}</label>
            <div className="flex gap-2">
              {STORED_ROUTINE_COLORS.map((color) => (
                <button key={color} type="button" onClick={() => setDraft({ ...draft, color })} className={cn('h-7 w-7 rounded-full transition-transform hover:scale-110 motion-reduce:hover:scale-100', draft.color === color && 'ring-2 ring-offset-2 ring-offset-[var(--bg-primary)]')} style={{ backgroundColor: color, color }} aria-label={t('routines.editor.useColor', { color })} />
              ))}
            </div>
          </div>

          <div>
            <label className={LABEL}>{t('routines.editor.schedule')}</label>
            {(
              <div className="mb-2 flex gap-2">
                <button type="button" onClick={() => setDraft({ ...draft, schedule: { type: 'calendar', weekdays: [], weekInterval: 1, anchorDate: localDateString() } })} className={cn('rounded-control border px-3 py-1.5 text-xs font-medium', calendar ? 'border-accent-blue bg-accent-blue/10 text-accent-blue' : 'border-[var(--border-color)] text-[var(--text-secondary)]')}>{t('routines.editor.onSchedule')}</button>
                <button type="button" onClick={() => setDraft({ ...draft, schedule: { type: 'after_completion', intervalDays: 14, firstDueDate: localDateString() } })} className={cn('rounded-control border px-3 py-1.5 text-xs font-medium', !calendar ? 'border-accent-blue bg-accent-blue/10 text-accent-blue' : 'border-[var(--border-color)] text-[var(--text-secondary)]')}>{t('routines.editor.afterCompletion')}</button>
              </div>
            )}
            <p className="mb-3 text-xs text-[var(--text-secondary)]">
              {calendar
                ? t('routines.editor.scheduleNote')
                : t('routines.editor.afterCompletionNote')}
            </p>
            {calendar ? (
              <div className="space-y-3 rounded-card border border-[var(--border-color)] p-3">
                <div className="flex gap-1.5">
                  {weekOrder.map((day) => {
                    const selected = calendar.weekdays.includes(day.id)
                    return (
                      <button key={day.id} type="button" onClick={() => setDraft({ ...draft, schedule: { ...calendar, weekdays: selected ? calendar.weekdays.filter((id) => id !== day.id) : [...calendar.weekdays, day.id].sort() } })} className={cn('h-8 w-8 rounded-full text-xs font-semibold', selected ? 'bg-accent-fill text-on-accent' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]')}>{t(day.label)}</button>
                    )
                  })}
                  <button type="button" onClick={() => setDraft({ ...draft, schedule: { ...calendar, weekdays: [] } })} className={cn('ml-1 rounded-control px-2 text-xs', calendar.weekdays.length === 0 ? 'bg-accent-blue/10 text-accent-blue' : 'text-[var(--text-secondary)]')}>{t('routines.editor.daily')}</button>
                </div>
                <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  {t('routines.editor.repeat')}
                  <select className="h-8 rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 text-[var(--text-primary)]" value={calendar.weekInterval} onChange={(event) => setDraft({ ...draft, schedule: { ...calendar, weekInterval: Number(event.target.value) } })}>
                    <option value={1}>{t('routines.editor.everyWeek')}</option>
                    <option value={2}>{t('routines.editor.everyWeeks', { count: 2 })}</option>
                    <option value={3}>{t('routines.editor.everyWeeks', { count: 3 })}</option>
                    <option value={4}>{t('routines.editor.everyWeeks', { count: 4 })}</option>
                  </select>
                </label>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-card border border-[var(--border-color)] p-3 text-xs text-[var(--text-secondary)]">
                <Trans
                  i18nKey="routines.editor.showAgain"
                  components={{
                    days: <input type="number" min={1} max={365} className="h-8 w-20 rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 text-[var(--text-primary)]" value={afterCompletion?.intervalDays ?? 14} onChange={(event) => afterCompletion && setDraft({ ...draft, schedule: { ...afterCompletion, intervalDays: Math.max(1, Number(event.target.value)) } })} />,
                  }}
                />
              </div>
            )}
          </div>

          <RoutineShareField carrier={carrier} onChange={setShare} />

          <div>
            <div className="mb-2 flex items-center">
              <label className="flex-1 text-caption uppercase tracking-wide text-[var(--text-secondary)]">{t('routines.editor.timesAndReminders')}</label>
              {draft.slots.length < MAX_ROUTINE_TIMES && <button type="button" onClick={() => setDraft({ ...draft, slots: [...draft.slots, newSlot(Math.max(...draft.slots.map((slot) => slot.reminderMinutes)))] })} className="flex items-center gap-1 text-xs font-medium text-accent-blue"><Plus className="h-3.5 w-3.5" /> {t('routines.editor.addTime')}</button>}
            </div>
            <div className="space-y-2">
              {draft.slots.map((slot) => (
                <div key={slot.id} className="rounded-card border border-[var(--border-color)] p-3">
                  <div className="flex items-center gap-2">
 <input type="time" aria-label={t('routines.editor.time')} className="h-8 rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 text-xs text-[var(--text-primary)]" value={timeLabel(slot.reminderMinutes)} onChange={(event) => { const [hours, minutes] = event.target.value.split(':').map(Number); updateSlot(slot.id, { reminderMinutes: hours * 60 + minutes }) }} />
                    <span className="flex-1" />
                    {draft.slots.length > 1 && <button type="button" aria-label={t('routines.editor.removeTime')} onClick={() => setDraft({ ...draft, slots: draft.slots.filter((item) => item.id !== slot.id) })} className="p-1 text-[var(--text-secondary)] hover:text-danger"><X className="h-4 w-4" /></button>}
                  </div>
                  <div className="mt-2 flex items-center gap-4">
                    <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"><Checkbox checked={slot.reminderEnabled} onChange={(event) => updateSlot(slot.id, { reminderEnabled: event.target.checked })} /><Bell className="h-3.5 w-3.5" /> {t('routines.editor.remindMe')}</label>
                    {slot.reminderEnabled && <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">{t('routines.editor.followUp')}<select className="h-7 rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-1 text-[var(--text-primary)]" value={slot.followUpMinutes} onChange={(event) => updateSlot(slot.id, { followUpMinutes: Number(event.target.value) })}><option value={0}>{t('routines.editor.followUpOff')}</option><option value={15}>{t('routines.editor.followUp15')}</option><option value={30}>{t('routines.editor.followUp30')}</option><option value={60}>{t('routines.editor.followUp60')}</option></select></label>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
          <button type="button" onClick={onClose} className="rounded-control border border-[var(--border-color)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">{t('routines.editor.cancel')}</button>
          <button type="submit" disabled={busy || !draft.name.trim() || draft.slots.length === 0 || share === null} className="rounded-control bg-accent-fill px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50">{busy ? t('routines.editor.saving') : carrier ? t('routines.editor.saveChanges') : t('routines.editor.create')}</button>
        </footer>
      </form>
    </DialogFrame>
  )
}

/** White or near-black, whichever reads better on a stored routine colour. */
function readableOn(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return '#FFFFFF'
  const value = parseInt(match[1], 16)
  const channel = (shift: number) => {
    const part = ((value >> shift) & 0xff) / 255
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
  return luminance > 0.5 ? '#1C1C1E' : '#FFFFFF'
}

const STATUS_WORDS: Record<string, TranslationKey> = { COMPLETED: 'routines.status.done', SKIPPED: 'routines.status.skipped', NOT_LOGGED: 'routines.status.notLogged', PENDING: 'routines.status.todo' }

/**
 * A routine's history (cross-app semantics 6.11, the rules in shared/routine-trend.ts): the summary
 * line, a month with a mark on each day, what the day picked holds, and for a schedule twelve
 * weeks of bars. Android's history dialog draws the same.
 */
function HistoryDialog({ carrier, onClose }: { carrier: RoutineCarrier<Task>; onClose: () => void }) {
  const { t } = useTranslation()
  const dateFormat = useDateFormat()
  const sharing = useRoutineSharing(carrier)
  const me = useCollabMe()
  const members = useProjectAccess(carrier.task.project_id).members
  const { records, loadingArchive, archiveError } = useRoutineHistory(carrier)
  const definition = carrier.payload.definition
  const today = localDateString()
  const weekStart = useWeekStart()
  const trend = useMemo(() => routineTrend(definition, records, today, weekStart), [definition, records, today, weekStart])
  const [picked, setPicked] = useState(today)
  const color = definition.color || STORED_ROUTINE_COLORS[0]
  const occurrences = trend.occurrencesOn(picked)

  const dayMark = (date: string, inMonth: boolean): DayMark => {
    const opacity = inMonth ? 1 : 0.4
    switch (trend.state(date)) {
      case 'done':
        return { style: { backgroundColor: color, color: readableOn(color), opacity }, note: t('routines.history.markDone') }
      case 'part':
        return { style: { backgroundColor: `color-mix(in srgb, ${color} 26%, transparent)`, opacity }, note: t('routines.history.markPartly') }
      case 'skipped':
        return { style: { boxShadow: `inset 0 0 0 1.5px ${color}`, opacity }, note: t('routines.history.markSkipped') }
      case 'missed':
        return { style: { opacity }, dot: true, note: t('routines.history.markNotLogged') }
      case 'open':
        return { style: { opacity }, note: t('routines.history.markTodo') }
      default:
        return { style: { color: 'var(--text-secondary)', opacity: opacity * 0.8 } }
    }
  }

  const weeks = trend.weeks
  const thisWeek = weeks?.[weeks.length - 1]
  return (
    <DialogFrame title={definition.name} onClose={onClose}>
      <div className="overflow-y-auto p-5">
        <p className="mb-4 text-sm text-[var(--text-secondary)]">{trend.summary}</p>
        {loadingArchive && <p className="mb-2 text-xs text-[var(--text-secondary)]">{t('routines.history.loading')}</p>}
        {archiveError && <p className="mb-2 text-xs text-danger">{t('routines.history.loadFailed', { error: archiveError })}</p>}
        <div className="grid gap-6 sm:grid-cols-[17rem_minmax(0,1fr)]">
          <MonthCalendar selected={picked} today={today} onPick={setPicked} dayMark={dayMark} />
          <div className="min-w-0">
            {weeks && (
              <div
                className="mb-4"
                role="img"
                aria-label={thisWeek && thisWeek.expected > 0 ? t('routines.history.weeksLabelThisWeek', { weeks: weeks.length, done: thisWeek.done, expected: thisWeek.expected }) : t('routines.history.weeksLabel', { weeks: weeks.length })}
              >
                <div className="flex h-8 items-end gap-1">
                  {weeks.map((week, index) => (
                    <div key={index} className="relative flex h-full flex-1 items-end">
                      {/* The line every bar stands on, so a week with nothing done still has its place. */}
                      <div className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-[var(--border-color)]" />
                      {week.expected > 0 && week.done > 0 && (
                        <div
                          className="relative w-full rounded-t-control"
                          style={{ height: `${Math.max(8, Math.round((week.done / week.expected) * 100))}%`, backgroundColor: color }}
                        />
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-caption text-[var(--text-secondary)]">
                  <span>{t('routines.history.weeksAgo', { weeks: weeks.length })}</span>
                  <span>{t('routines.history.thisWeek')}</span>
                </div>
              </div>
            )}
            <h3 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">
              {formatDateChip(new Date(`${picked}T12:00:00`), true, new Date(), dateFormat)}
            </h3>
            {occurrences.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">{picked > today ? t('routines.history.stillToCome') : t('routines.history.nothingScheduled')}</p>
            ) : (
              <div className="divide-y divide-[var(--border-color)]">
                {occurrences.map((occurrence) => (
                  <div key={occurrence.slotId} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="text-[var(--text-secondary)]">{formatMinutesOfDay(occurrence.minutes, dateFormat)}</span>
                    <span className="text-[var(--text-primary)]">
                      {/* "Done by Maya" on a shared routine, else the plain status. */}
                      {(sharing.shared && loggedByText(occurrence.status, occurrence.record, me?.id, members)) || (STATUS_WORDS[occurrence.status] ? t(STATUS_WORDS[occurrence.status]) : undefined)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </DialogFrame>
  )
}

export function RoutinesView() {
  const { t } = useTranslation()
  const { data: config } = useAppConfig()
  // The sidebar hides Routines when they are off; a route kept from before (history, a link) lands here.
  if (config && !isRoutinesEnabled(config)) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 bg-[var(--bg-primary)] px-6 text-center">
        <HeartPulse className="h-8 w-8 text-[var(--text-tertiary)]" />
        <p className="text-sm font-medium text-[var(--text-primary)]">{t('routines.off.title')}</p>
        <p className="text-xs text-[var(--text-secondary)]">{t('routines.off.note')}</p>
      </div>
    )
  }
  return <RoutinesContent />
}

function RoutinesContent() {
  const { t } = useTranslation()
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
      setExportError(error instanceof Error ? error.message : t('routines.exportFailed'))
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-[var(--bg-primary)]">
      <PageHeader
        title={t('routines.title')}
        subtitle={t('routines.subtitle')}
        icon={<SmartListIcon list="routines" className="h-5 w-5" />}
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv} disabled={routines.carriers.length === 0}><Download className="h-4 w-4" /> {t('routines.export')}</Button>
            <Button variant="primary" onClick={() => setEditor('new')}><Plus className="h-4 w-4" /> {t('routines.newRoutine')}</Button>
          </>
        }
      />

      <ReadingScroll columnClassName="pb-10">
        <div>
          <RoutineTodaySection showEmpty />

          <section className="px-6 pt-6">
            <ListSectionHeader level={1} title={t('routines.yourRoutines')} count={active.length} sticky={false} className="mb-3 px-0" />
            {routines.isLoading && <div className="rounded-card border border-[var(--border-color)] p-8 text-center text-sm text-[var(--text-secondary)]">{t('routines.loading')}</div>}
            {!routines.isLoading && active.length === 0 && (
              <EmptyState
                icon={Plus}
                identity="routines"
                title={t('routines.empty.title')}
                subtitle={t('routines.empty.subtitle')}
                className="py-10"
                action={<Button variant="secondary" onClick={() => setEditor('new')}><Plus className="h-4 w-4" /> {t('routines.empty.create')}</Button>}
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
              <button type="button" onClick={() => setShowArchived(!showArchived)} aria-expanded={showArchived} className="mb-3 flex h-8 w-full items-center gap-2 text-left text-section text-text"><span>{t('routines.archived')}</span><span className="font-medium tabular-nums text-text-secondary">{routines.archived.length}</span></button>
              {showArchived && <div className="space-y-2">{routines.archived.map((carrier) => <ArchivedRoutineRow key={carrier.payload.definition.id} carrier={carrier} onRestore={() => routines.archiveRoutine.mutate({ carrier, archived: false })} onDelete={() => { if (window.confirm(t('routines.deleteConfirm', { name: carrier.payload.definition.name }))) routines.deleteRoutine.mutate(carrier) }} />)}</div>}
            </section>
          )}

          {routines.updateRequired > 0 && <div className="mx-6 mt-5 rounded-card border border-status-today/30 bg-status-today/10 px-4 py-3 text-xs text-status-today">{t('routines.updateRequired', { count: routines.updateRequired })}</div>}
          {routines.unreadable > 0 && <div className="mx-6 mt-5 rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger">{t('routines.unreadable', { count: routines.unreadable })}</div>}
          {routines.archiveWarning && <div className="mx-6 mt-5 rounded-card border border-status-today/30 bg-status-today/10 px-4 py-3 text-xs text-status-today">{t('routines.archiveWarning', { warning: routines.archiveWarning })}</div>}
          {exportError && <div className="mx-6 mt-5 rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger">{exportError}</div>}
          {routines.error && <div className="mx-6 mt-5 rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger">{routines.error instanceof Error ? routines.error.message : t('routines.updateFailed')}</div>}
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
  const { t } = useTranslation()
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
      <button type="button" title={t('routines.card.history')} onClick={onHistory} className="rounded-control p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><History className="h-4 w-4" /></button>
      {sharing.canWrite && <button type="button" title={t('routines.card.edit')} onClick={onEdit} className="rounded-control p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><ChevronRight className="h-4 w-4" /></button>}
      {member && sharing.canWrite && (
        <button
          type="button"
          title={remindersOn ? t('routines.card.remindersOff') : t('routines.card.remindersOn')}
          aria-label={remindersOn ? t('routines.card.remindersOff') : t('routines.card.remindersOn')}
          onClick={() => setPref.mutate({ key: routineRemindersKey(definition.id), value: remindersOn ? 'off' : null })}
          className="rounded-control p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          {remindersOn ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        </button>
      )}
      {member && (
        <button type="button" title={t('routines.card.hideForMe')} aria-label={t('routines.card.hideForMe')} onClick={() => setPref.mutate({ key: routineHiddenKey(definition.id), value: true })} className="rounded-control p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><EyeOff className="h-4 w-4" /></button>
      )}
      {sharing.own && <button type="button" title={t('routines.card.archive')} onClick={onArchive} className="rounded-control p-2 text-[var(--text-secondary)] opacity-0 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] group-hover:opacity-100"><Archive className="h-4 w-4" /></button>}
    </article>
  )
}

/** An archived routine: only its owner restores or deletes it (section 6.9). */
function ArchivedRoutineRow({ carrier, onRestore, onDelete }: { carrier: RoutineCarrier<Task>; onRestore: () => void; onDelete: () => void }) {
  const { t } = useTranslation()
  const sharing = useRoutineSharing(carrier)
  return (
    <div className="flex items-center gap-3 rounded-card border border-[var(--border-color)] px-3 py-2.5">
      <Archive className="h-4 w-4 text-[var(--text-secondary)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-[var(--text-primary)]">{carrier.payload.definition.name}</span>
        <SharedRoutineLabel sharing={sharing} className="block" />
      </span>
      {sharing.own && <button type="button" onClick={onRestore} className="flex items-center gap-1 text-xs font-medium text-accent-blue"><Undo2 className="h-3.5 w-3.5" /> {t('routines.restore')}</button>}
      {sharing.own && <button type="button" aria-label={t('routines.deleteName', { name: carrier.payload.definition.name })} onClick={onDelete} className="rounded-control p-1.5 text-[var(--text-secondary)] hover:bg-danger/10 hover:text-danger"><Trash2 className="h-4 w-4" /></button>}
    </div>
  )
}
