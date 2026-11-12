import { useState } from 'react'
import { Checkbox } from '@/components/shared/Checkbox'
import { useAvailability } from '@/hooks/use-availability'
import { useProPrefs } from '@/hooks/use-pro-prefs'
import type { RepeatRule } from '../../../shared/pro/prefs'

type Ends = 'never' | 'until' | 'count'

/**
 * Pro's repeat rule (cross-app semantics 21.13) under the repeat choices: when the repeat ends (a day
 * or a number of times) and whether a late completion catches up. Synced.
 */
export function RepeatRuleFields({ taskId }: { taskId: number }) {
  const { on } = useAvailability()
  const prefs = useProPrefs()
  const rule = prefs.repeatRule(taskId)
  const ends: Ends = rule?.until ? 'until' : rule?.count ? 'count' : 'never'
  const [count, setCount] = useState(String(rule?.count ?? 5))
  if (!on) return null

  const write = (next: RepeatRule) => {
    const clean: RepeatRule = {}
    if (next.until) clean.until = next.until
    if (next.count) clean.count = next.count
    if (next.catch_up) clean.catch_up = true
    void prefs.setRepeatRule(taskId, Object.keys(clean).length ? clean : null)
  }

  return (
    <div className="mt-2 border-t border-border px-2 pb-1 pt-2" data-pro-repeat-rule>
      <p className="mb-1 text-meta font-medium text-text">Ends</p>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Ends">
        {(['never', 'until', 'count'] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={ends === choice}
            onClick={() => {
              if (choice === 'never') write({ catch_up: rule?.catch_up })
              else if (choice === 'until') {
                const inMonth = new Date()
                inMonth.setMonth(inMonth.getMonth() + 1)
                const day = `${inMonth.getFullYear()}-${String(inMonth.getMonth() + 1).padStart(2, '0')}-${String(inMonth.getDate()).padStart(2, '0')}`
                write({ until: rule?.until ?? day, catch_up: rule?.catch_up })
              } else write({ count: Number(count) || 5, catch_up: rule?.catch_up })
            }}
            className={ends === choice
              ? 'rounded-chip border border-accent-blue bg-accent-blue/12 px-2 py-0.5 text-meta text-accent-blue'
              : 'rounded-chip border border-border px-2 py-0.5 text-meta text-text-secondary hover:bg-bg-hover'}
          >
            {choice === 'never' ? 'Never' : choice === 'until' ? 'On a day' : 'After times'}
          </button>
        ))}
      </div>
      {ends === 'until' && (
        <input
          type="date"
          aria-label="Last day"
          value={rule?.until ?? ''}
          onChange={(event) => event.target.value && write({ until: event.target.value, catch_up: rule?.catch_up })}
          className="mt-2 rounded-control border border-border bg-bg-page px-2 py-1 text-meta text-text"
        />
      )}
      {ends === 'count' && (
        <label className="mt-2 flex items-center gap-2 text-meta text-text">
          <input
            type="number"
            min={1}
            max={999}
            aria-label="Times left"
            value={count}
            onChange={(event) => setCount(event.target.value)}
            onBlur={() => {
              const times = Math.floor(Number(count))
              if (times >= 1) write({ count: times, catch_up: rule?.catch_up })
            }}
            className="w-16 rounded-control border border-border bg-bg-page px-2 py-1 text-meta text-text"
          />
          more times, this one included
        </label>
      )}
      <label className="mt-2 flex cursor-pointer items-center gap-2">
        <Checkbox checked={rule?.catch_up === true} onChange={(event) => write({ ...rule, catch_up: event.target.checked })} />
        <span className="text-meta text-text">Catch up: skip dates that have passed</span>
      </label>
    </div>
  )
}
