import { useEffect, useState } from 'react'
import { Checkbox } from '@/components/shared/Checkbox'
import { cn } from '@/lib/cn'
import { useAppConfig } from '@/hooks/use-app-config'
import { usePlannerPrefs, useSavePlannerConfig } from '@/hooks/use-planner'
import { formatLength } from '@/lib/planner-timeline'
import { isRoutinesEnabled } from '@/lib/vikunja-types'
import { BLOCK_LENGTHS, readPlannerHours } from '../../../shared/time-blocks'
import { CalendarFeeds } from './CalendarFeeds'

/**
 * The planner's settings, shared by the Plan screen's gear and Settings. In the gear (`compact`)
 * the Events and calendars are a summary with Manage, which opens them in Settings.
 */
export function PlannerOptions({ compact = false }: { compact?: boolean }) {
  const prefs = usePlannerPrefs()
  const { data: config } = useAppConfig()
  const save = useSavePlannerConfig()
  const [from, setFrom] = useState(prefs.hours[0])
  const [to, setTo] = useState(prefs.hours[1])
  useEffect(() => {
    setFrom(prefs.hours[0])
    setTo(prefs.hours[1])
  }, [prefs.hours[0], prefs.hours[1]])

  // An invalid pair (the start after the end) is not saved and goes back to what it was.
  const commitHours = () => {
    const next = readPlannerHours([from, to])
    if (next[0] === from && next[1] === to) {
      prefs.setHours([from, to])
    } else {
      setFrom(prefs.hours[0])
      setTo(prefs.hours[1])
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-meta font-medium text-text">Default length</p>
        <div className="mt-1 flex flex-wrap gap-1" role="radiogroup" aria-label="Default length">
          {BLOCK_LENGTHS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              role="radio"
              aria-checked={prefs.defaultLength === minutes}
              data-plan-length={minutes}
              onClick={() => prefs.setDefaultLength(minutes)}
              className={cn(
                'rounded-chip border px-2 py-0.5 text-meta',
                prefs.defaultLength === minutes
                  ? 'border-accent-blue bg-accent-blue/12 text-accent-blue'
                  : 'border-border text-text-secondary hover:bg-bg-hover',
              )}
            >
              {formatLength(minutes)}
            </button>
          ))}
        </div>
        <p className="mt-1 text-caption text-text-secondary">What a task takes when you drop it on a time. Synced to your other devices.</p>
      </div>

      <div>
        <p className="text-meta font-medium text-text">Work hours</p>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="time"
            aria-label="Work hours start"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            onBlur={commitHours}
            className="rounded-control border border-border bg-transparent px-2 py-1 text-meta text-text"
          />
          <span className="text-meta text-text-secondary">to</span>
          <input
            type="time"
            aria-label="Work hours end"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            onBlur={commitHours}
            className="rounded-control border border-border bg-transparent px-2 py-1 text-meta text-text"
          />
        </div>
        <p className="mt-1 text-caption text-text-secondary">Used for free time, Fit and Plan my day. Synced to your other devices.</p>
      </div>

      <div>
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox
            data-plan-nudge-setting
            checked={typeof config?.planner_nudge === 'string'}
            onChange={(event) => save({ planner_nudge: event.target.checked ? '21:30' : null })}
          />
          <span className="text-meta text-text">Ask me to plan tomorrow</span>
        </label>
        {typeof config?.planner_nudge === 'string' && (
          <input
            type="time"
            aria-label="Ask at"
            value={config.planner_nudge}
            onChange={(event) => {
              if (event.target.value) save({ planner_nudge: event.target.value })
            }}
            className="ml-[26px] mt-1 rounded-control border border-border bg-transparent px-2 py-1 text-meta text-text"
          />
        )}
      </div>

      {isRoutinesEnabled(config) && (
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox
            checked={config?.planner_show_routines !== false}
            onChange={(event) => save({ planner_show_routines: event.target.checked })}
          />
          <span className="text-meta text-text">Show routines on the timeline</span>
        </label>
      )}

      <div className="border-t border-border pt-3">
        <CalendarFeeds summary={compact} />
      </div>
    </div>
  )
}
