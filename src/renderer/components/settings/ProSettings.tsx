import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Checkbox } from '@/components/shared/Checkbox'
import { Switch } from '@/components/shared/Switch'
import { usePro, useSaveProConfig } from '@/hooks/use-pro'
import { useProPrefs } from '@/hooks/use-pro-prefs'
import { useProLedger, writeLedger } from '@/hooks/use-pro-ledger'
import { useProjectCategories } from '@/hooks/use-project-categories'
import { useLabels } from '@/hooks/use-labels'
import { useTasks } from '@/hooks/use-tasks'
import { useOpenTask } from '@/hooks/use-open-task'
import { NULL_DATE } from '@/lib/constants'
import { PRO_LAYERS, type ProLayer } from '../../../shared/pro/settings'
import { ledgerSettings } from '../../../shared/pro/ledger'
import { startDateOf } from '../../../shared/pro/start-dates'
import { toLocalDate } from '../../../shared/due-dates'

const CARD = 'rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5'
const FIELD = 'rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)]'

const LAYER_TEXT: Record<ProLayer, { name: string; note: string }> = {
  availability: {
    name: 'Know what you can do now',
    note: 'Start dates, on hold, after, sequential projects, flags, focus, estimates and repeat ends.',
  },
  promises: {
    name: 'Promises and people',
    note: 'People, what you promised and what they promised, recaps, meetings and import.',
  },
  portfolio: {
    name: 'Portfolio',
    note: 'Initiatives, the cap, readiness, escalations, the sponsor desk and the logs.',
  },
  power: {
    name: 'Power tools',
    note: 'Pro list conditions, columns, the batch inspector, the focus block and the weekly execution review.',
  },
}

const LONE_START_QUERY = {
  filter: `done = false && start_date != '${NULL_DATE}'`,
  sort_by: 'start_date',
  order_by: 'asc',
  keep_nested_subtasks: true,
}

/**
 * Settings, Pro (cross-app semantics 21.1). The switch and the layers are per device; the area, the
 * cap and the escalation rule are synced. Turning Pro off writes nothing but this device's switch.
 */
export function ProSettings() {
  const { on, layers, config } = usePro()
  const save = useSaveProConfig()
  const standalone = !!config?.standalone_mode

  return (
    <>
      <div className={CARD}>
        <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Pro</h2>
        <p className="mb-4 text-xs text-[var(--text-secondary)]">
          Extra tools for heavier work: what you can do now, promises to and from people, a portfolio of initiatives.
          Pro only adds. Turn it off and Vicu is as it was; nothing is removed. This choice is for this device.
        </p>
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-sm text-[var(--text-primary)]">Turn on Pro on this device</span>
          <Switch
            checked={on}
            disabled={standalone}
            onCheckedChange={(checked) => void save({ pro_enabled: checked })}
          />
        </label>
        {standalone && (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">Pro needs a Vikunja server; it is not available in standalone mode.</p>
        )}
        {on && (
          <div className="mt-4 space-y-3 border-t border-[var(--border-color)] pt-4">
            {PRO_LAYERS.map((layer) => (
              <label key={layer} className="flex cursor-pointer items-start gap-2">
                <Checkbox
                  checked={layers[layer]}
                  data-pro-layer={layer}
                  onChange={(event) => void save({ pro_layers: { ...layers, [layer]: event.target.checked } })}
                />
                <span>
                  <span className="block text-sm text-[var(--text-primary)]">{LAYER_TEXT[layer].name}</span>
                  <span className="block text-xs text-[var(--text-secondary)]">{LAYER_TEXT[layer].note}</span>
                </span>
              </label>
            ))}
            <label className="flex cursor-pointer items-start gap-2 border-t border-[var(--border-color)] pt-3">
              <Checkbox
                checked={config?.pro_assistant === true}
                onChange={(event) => void save({ pro_assistant: event.target.checked })}
              />
              <span>
                <span className="block text-sm text-[var(--text-primary)]">Assistant help in Pro</span>
                <span className="block text-xs text-[var(--text-secondary)]">
                  Promise drafts, import from any text and the Pro questions in Ask, on the model set in Assistant. Work text goes to that
                  provider; check that your employer allows it.
                </span>
              </span>
            </label>
          </div>
        )}
      </div>
      {on && <StartDateNotice />}
      {on && layers.promises && <AreaSettings />}
      {on && layers.portfolio && <PortfolioSettings />}
    </>
  )
}

/** The first-run notice (21.3): tasks that already have a start date from Vikunja's web app. */
function StartDateNotice() {
  const { config } = usePro()
  const save = useSaveProConfig()
  const seen = !!config?.pro_onboarding_seen
  const { data } = useTasks(LONE_START_QUERY, !seen)
  const open = useOpenTask()
  const [showing, setShowing] = useState(false)
  const starting = useMemo(() => (data ?? []).filter((task) => startDateOf(task) !== null), [data])
  if (seen || !data) return null
  return (
    <div className={CARD} data-pro-onboarding>
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Start dates</h2>
      <p className="text-sm text-[var(--text-secondary)]">
        {starting.length === 0
          ? 'With Pro, a task with a start date waits until that day. None of your open tasks has one yet.'
          : `With Pro, a task with a start date waits until that day. ${starting.length} open ${starting.length === 1 ? 'task has' : 'tasks have'} one already, set in Vikunja's web app or another device.`}
      </p>
      {showing && (
        <ul className="mt-3 max-h-60 space-y-1 overflow-y-auto">
          {starting.map((task) => (
            <li key={task.id}>
              <button type="button" className="text-left text-sm text-accent-blue hover:underline" onClick={() => open(task.id)}>
                {task.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-3">
        {starting.length > 0 && !showing && (
          <button type="button" className="text-sm font-medium text-accent-blue" onClick={() => setShowing(true)}>
            Show them
          </button>
        )}
        <button type="button" className="text-sm font-medium text-[var(--text-secondary)]" onClick={() => void save({ pro_onboarding_seen: true })}>
          Got it
        </button>
      </div>
    </div>
  )
}

/** The area (21.1): the categories promises and the portfolio apply to. Synced. */
function AreaSettings() {
  const { categories } = useProjectCategories()
  const { area, setArea } = useProPrefs()
  const chosen = new Set(area)
  return (
    <div className={CARD}>
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Work area</h2>
      <p className="mb-4 text-xs text-[var(--text-secondary)]">
        Promises, people and the portfolio apply to projects in these categories. With none ticked they apply to every project.
        Shared with your other devices.
      </p>
      {categories.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">You have no project categories. Add one in Settings, Projects to limit Pro to it.</p>
      ) : (
        <div className="space-y-2">
          {categories.map((category) => (
            <label key={category.id} className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={chosen.has(category.id)}
                onChange={(event) => {
                  const next = new Set(chosen)
                  if (event.target.checked) next.add(category.id)
                  else next.delete(category.id)
                  void setArea(categories.map((c) => c.id).filter((id) => next.has(id)))
                }}
              />
              <span className="text-sm text-[var(--text-primary)]">{category.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

/** The cap, its agreement and the escalation rule (21.10). Synced through the ledger. */
function PortfolioSettings() {
  const queryClient = useQueryClient()
  const { ledger } = useProLedger()
  const settings = ledgerSettings(ledger)
  const { people } = useProPrefs()
  const { data: labels } = useLabels()
  const personLabels = (labels ?? []).filter((label) => people.has(label.id))
  const write = (value: Record<string, unknown>) => void writeLedger(queryClient, [{ op: 'settings', value: { ...settings, ...value } }])
  const today = toLocalDate(new Date())

  return (
    <div className={CARD}>
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Portfolio</h2>
      <p className="mb-4 text-xs text-[var(--text-secondary)]">Shared with your other devices.</p>
      <div className="space-y-4">
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--text-primary)]">Active initiatives at most</span>
          <input
            type="number"
            min={1}
            max={50}
            className={`${FIELD} w-20`}
            value={settings.cap}
            onChange={(event) => {
              const cap = Math.floor(Number(event.target.value))
              if (cap >= 1) write({ cap, cap_agreed: null })
            }}
          />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--text-primary)]">Agreed with</span>
          <select
            className={FIELD}
            value={settings.cap_agreed ? String(settings.cap_agreed.by ?? '') : 'none'}
            onChange={(event) => {
              const value = event.target.value
              if (value === 'none') write({ cap_agreed: null })
              else write({ cap_agreed: { by: value === '' ? null : Number(value), on: today } })
            }}
          >
            <option value="none">Not agreed yet</option>
            <option value="">Someone not in Vicu</option>
            {personLabels.map((label) => (
              <option key={label.id} value={String(label.id)}>{label.title}</option>
            ))}
          </select>
        </label>
        {settings.cap_agreed && (
          <p className="text-xs text-[var(--text-secondary)]">Agreed on {settings.cap_agreed.on}.</p>
        )}
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--text-primary)]">Draft an escalation after this many misses</span>
          <input
            type="number"
            min={1}
            max={10}
            className={`${FIELD} w-20`}
            value={settings.threshold}
            onChange={(event) => {
              const threshold = Math.floor(Number(event.target.value))
              if (threshold >= 1) write({ threshold })
            }}
          />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--text-primary)]">Escalation rule agreed on</span>
          <input
            type="date"
            className={FIELD}
            value={settings.rule_agreed_on ?? ''}
            onChange={(event) => write({ rule_agreed_on: event.target.value || null })}
          />
        </label>
      </div>
    </div>
  )
}
