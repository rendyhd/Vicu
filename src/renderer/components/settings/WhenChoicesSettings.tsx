import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { Button } from '@/components/shared/Button'
import { Checkbox } from '@/components/shared/Checkbox'
import { useWhenChoices } from '@/hooks/use-when-choices'
import {
  DAY_CHOICES,
  MAX_DAYS,
  MAX_MOVE_BY,
  MAX_NAME_LENGTH,
  MAX_TIMES,
  MOVE_STEPS,
  isValidTimeName,
  type DayChoiceId,
  type MoveStepId,
  type TimeOfDay,
} from '../../../shared/when-choices'

const inputClass =
  'rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-sm text-[var(--text-primary)]'

/** What is wrong with a draft of the times of day (section 22.1), or null when it can be saved. */
function timesProblem(times: readonly TimeOfDay[]): string | null {
  if (times.length === 0) return 'Keep at least one time.'
  if (times.some((t) => !isValidTimeName(t.name))) {
    return `A name is 1 to ${MAX_NAME_LENGTH} letters, digits and single spaces.`
  }
  if (new Set(times.map((t) => t.name.toLowerCase())).size !== times.length) return 'Two times have the same name.'
  if (times.some((t) => !/^\d{2}:\d{2}$/.test(t.time))) return 'Pick a time for each.'
  if (new Set(times.map((t) => t.time)).size !== times.length) return 'Two times are at the same time.'
  return null
}

/**
 * Settings, General, When choices (cross-app semantics section 22): the times of day, the day
 * choices of the When panel in their order, and the Move by steps. Synced, so they are the same on
 * every device of the account; the quick-add parser reads the times of day too ("tomorrow morning").
 */
export function WhenChoicesSettings() {
  const choices = useWhenChoices()

  // The times are edited as a draft and saved whenever the draft keeps the rules.
  const [draft, setDraft] = useState<TimeOfDay[]>(() => [...choices.times])
  const saved = JSON.stringify(choices.times)
  useEffect(() => setDraft(JSON.parse(saved) as TimeOfDay[]), [saved])
  const problem = timesProblem(draft)

  const changeTimes = (next: TimeOfDay[]) => {
    setDraft(next)
    if (timesProblem(next) === null) void choices.setTimes(next)
  }

  const freeTime = () => {
    for (let h = 8; h < 24; h++) {
      const time = `${String(h).padStart(2, '0')}:00`
      if (!draft.some((t) => t.time === time)) return time
    }
    return '07:00'
  }

  const shownDays: DayChoiceId[] = [
    ...choices.days,
    ...DAY_CHOICES.map((c) => c.id).filter((id) => !choices.days.includes(id)),
  ]
  const toggleDay = (id: DayChoiceId, on: boolean) =>
    void choices.setDays(on ? [...choices.days, id] : choices.days.filter((d) => d !== id))
  const moveDayChoice = (id: DayChoiceId, by: -1 | 1) => {
    const days = [...choices.days]
    const i = days.indexOf(id)
    const j = i + by
    if (i < 0 || j < 0 || j >= days.length) return
    ;[days[i], days[j]] = [days[j], days[i]]
    void choices.setDays(days)
  }
  const toggleStep = (id: MoveStepId, on: boolean) => {
    const next = on ? [...choices.moveBy, id] : choices.moveBy.filter((s) => s !== id)
    // Shown in the catalogue's order.
    void choices.setMoveBy(MOVE_STEPS.map((s) => s.id).filter((s) => next.includes(s)))
  }

  return (
    <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5" data-when-choices>
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">When choices</h2>
      <p className="mb-4 text-xs text-[var(--text-secondary)]">
        What the When panel and Postpone offer, on every device. Quick add reads the times too: "tomorrow morning".
      </p>

      <h3 className="mb-2 text-xs font-medium text-[var(--text-secondary)]">Times of day</h3>
      <ul className="flex flex-col gap-1.5" aria-label="Times of day">
        {draft.map((entry, index) => (
          <li key={index} className="flex items-center gap-2">
            <input
              type="text"
              aria-label="Name"
              value={entry.name}
              maxLength={MAX_NAME_LENGTH}
              onChange={(e) => changeTimes(draft.map((t, i) => (i === index ? { ...t, name: e.target.value } : t)))}
              className={`${inputClass} w-40`}
            />
            <input
              type="time"
              aria-label={`Time of ${entry.name || 'this entry'}`}
              value={entry.time}
              onChange={(e) => changeTimes(draft.map((t, i) => (i === index ? { ...t, time: e.target.value } : t)))}
              className={inputClass}
            />
            <Button
              variant="quiet"
              aria-label={`Remove ${entry.name || 'this time'}`}
              disabled={draft.length <= 1}
              onClick={() => changeTimes(draft.filter((_, i) => i !== index))}
              className="px-1.5"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-3">
        <Button
          variant="quiet"
          disabled={draft.length >= MAX_TIMES}
          onClick={() => changeTimes([...draft, { name: `Time ${draft.length + 1}`, time: freeTime() }])}
          className="px-2"
        >
          <Plus className="h-3.5 w-3.5" />
          Add time
        </Button>
        {problem && (
          <span role="alert" className="text-xs text-danger">
            {problem}
          </span>
        )}
      </div>

      <h3 className="mb-2 mt-5 text-xs font-medium text-[var(--text-secondary)]">
        Day choices <span className="font-normal">(up to {MAX_DAYS}, in this order)</span>
      </h3>
      <ul className="flex flex-col gap-1" aria-label="Day choices">
        {shownDays.map((id) => {
          const on = choices.days.includes(id)
          const index = choices.days.indexOf(id)
          const label = DAY_CHOICES.find((c) => c.id === id)!.label
          return (
            <li key={id} className="flex items-center gap-2">
              <label className="flex flex-1 cursor-pointer items-center gap-2">
                <Checkbox
                  checked={on}
                  disabled={!on && choices.days.length >= MAX_DAYS}
                  onChange={(e) => toggleDay(id, e.target.checked)}
                />
                <span className={on ? 'text-sm text-[var(--text-primary)]' : 'text-sm text-[var(--text-secondary)]'}>{label}</span>
              </label>
              {on && (
                <>
                  <Button variant="quiet" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => moveDayChoice(id, -1)} className="px-1.5">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="quiet"
                    aria-label={`Move ${label} down`}
                    disabled={index === choices.days.length - 1}
                    onClick={() => moveDayChoice(id, 1)}
                    className="px-1.5"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </li>
          )
        })}
      </ul>

      <h3 className="mb-2 mt-5 text-xs font-medium text-[var(--text-secondary)]">
        Move by <span className="font-normal">(up to {MAX_MOVE_BY}, for a task that has a date)</span>
      </h3>
      <div className="flex flex-wrap gap-x-4 gap-y-1" role="group" aria-label="Move by">
        {MOVE_STEPS.map((step) => {
          const on = choices.moveBy.includes(step.id)
          return (
            <label key={step.id} className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={on}
                disabled={!on && choices.moveBy.length >= MAX_MOVE_BY}
                onChange={(e) => toggleStep(step.id, e.target.checked)}
              />
              <span className="text-sm text-[var(--text-primary)]">{step.label}</span>
            </label>
          )
        })}
      </div>

      <div className="mt-5 border-t border-[var(--border-color)] pt-3">
        <Button variant="quiet" onClick={() => void choices.reset()} className="px-2">
          Reset to defaults
        </Button>
      </div>
    </div>
  )
}
