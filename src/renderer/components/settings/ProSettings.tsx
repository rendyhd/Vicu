import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../../shared/i18n'
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
import { DEFAULT_CHECK_DAYS, MAX_CHECK_DAYS, readCheckDays, readWorkdays } from '../../../shared/pro/working-days'
import { readNoteDay } from '../../../shared/pro/follow-ups'
import { availableLanguages, languageName } from '../../../shared/i18n'
import { textLanguage } from '../../../shared/pro/documents'
import { useWeekStart } from '@/hooks/use-week-start'
import { startDateOf } from '../../../shared/pro/start-dates'
import { toLocalDate } from '../../../shared/due-dates'
import { can } from '@/lib/capabilities'

const CARD = 'rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5'
const FIELD = 'rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)]'

const LAYER_TEXT: Record<ProLayer, { name: TranslationKey; note: TranslationKey }> = {
  availability: {
    name: 'settings.pro.layers.availability.name',
    note: 'settings.pro.layers.availability.note',
  },
  promises: {
    name: 'settings.pro.layers.promises.name',
    note: 'settings.pro.layers.promises.note',
  },
  portfolio: {
    name: 'settings.pro.layers.portfolio.name',
    note: 'settings.pro.layers.portfolio.note',
  },
  power: {
    name: 'settings.pro.layers.power.name',
    note: 'settings.pro.layers.power.note',
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
  const { t } = useTranslation()
  const { on, layers, config } = usePro()
  const save = useSaveProConfig()
  const standalone = !!config?.standalone_mode

  return (
    <>
      <div className={CARD}>
        <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">{t('settings.pro.title')}</h2>
        <p className="mb-4 text-xs text-[var(--text-secondary)]">
          {t('settings.pro.note')}
        </p>
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-sm text-[var(--text-primary)]">{t('settings.pro.turnOn')}</span>
          <Switch
            checked={on}
            disabled={standalone}
            onCheckedChange={(checked) => void save({ pro_enabled: checked })}
          />
        </label>
        {standalone && (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">{t('settings.pro.standalone')}</p>
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
                  <span className="block text-sm text-[var(--text-primary)]">{t(LAYER_TEXT[layer].name)}</span>
                  <span className="block text-xs text-[var(--text-secondary)]">{t(LAYER_TEXT[layer].note)}</span>
                </span>
              </label>
            ))}
            {can('assistant') && (
            <label className="flex cursor-pointer items-start gap-2 border-t border-[var(--border-color)] pt-3">
              <Checkbox
                checked={config?.pro_assistant === true}
                onChange={(event) => void save({ pro_assistant: event.target.checked })}
              />
              <span>
                <span className="block text-sm text-[var(--text-primary)]">{t('settings.pro.assistant.title')}</span>
                <span className="block text-xs text-[var(--text-secondary)]">
                  {t('settings.pro.assistant.note')}
                </span>
              </span>
            </label>
            )}
          </div>
        )}
      </div>
      {on && <StartDateNotice />}
      {on && layers.promises && <AreaSettings />}
      {on && layers.promises && <FollowUpSettings />}
      {on && layers.portfolio && <PortfolioSettings />}
    </>
  )
}

/** The first-run notice (21.3): tasks that already have a start date from Vikunja's web app. */
function StartDateNotice() {
  const { t } = useTranslation()
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
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">{t('settings.pro.startDates.title')}</h2>
      <p className="text-sm text-[var(--text-secondary)]">
        {starting.length === 0
          ? t('settings.pro.startDates.none')
          : t('settings.pro.startDates.some', { count: starting.length })}
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
            {t('settings.pro.startDates.show')}
          </button>
        )}
        <button type="button" className="text-sm font-medium text-[var(--text-secondary)]" onClick={() => void save({ pro_onboarding_seen: true })}>
          {t('settings.pro.startDates.gotIt')}
        </button>
      </div>
    </div>
  )
}

/** The area (21.1): the categories promises and the portfolio apply to. Synced. */
function AreaSettings() {
  const { t } = useTranslation()
  const { categories } = useProjectCategories()
  const { area, setArea } = useProPrefs()
  const chosen = new Set(area)
  return (
    <div className={CARD}>
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">{t('settings.pro.area.title')}</h2>
      <p className="mb-4 text-xs text-[var(--text-secondary)]">
        {t('settings.pro.area.note')}
      </p>
      {categories.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">{t('settings.pro.area.empty')}</p>
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
  const { t } = useTranslation()
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
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">{t('settings.pro.portfolio.title')}</h2>
      <p className="mb-4 text-xs text-[var(--text-secondary)]">{t('settings.pro.portfolio.note')}</p>
      <div className="space-y-4">
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--text-primary)]">{t('settings.pro.portfolio.noLimit')}</span>
          <input
            type="checkbox"
            checked={settings.cap_off === true}
            onChange={(event) => write({ cap_off: event.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--text-primary)]">{t('settings.pro.portfolio.cap')}</span>
          <input
            type="number"
            min={1}
            max={50}
            className={`${FIELD} w-20`}
            disabled={settings.cap_off === true}
            value={settings.cap}
            onChange={(event) => {
              const cap = Math.floor(Number(event.target.value))
              if (cap >= 1) write({ cap, cap_off: false, cap_agreed: null })
            }}
          />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--text-primary)]">{t('settings.pro.portfolio.agreedWith')}</span>
          <select
            className={FIELD}
            value={settings.cap_agreed ? String(settings.cap_agreed.by ?? '') : 'none'}
            onChange={(event) => {
              const value = event.target.value
              if (value === 'none') write({ cap_agreed: null })
              else write({ cap_agreed: { by: value === '' ? null : Number(value), on: today } })
            }}
          >
            <option value="none">{t('settings.pro.portfolio.notAgreed')}</option>
            <option value="">{t('settings.pro.portfolio.outsider')}</option>
            {personLabels.map((label) => (
              <option key={label.id} value={String(label.id)}>{label.title}</option>
            ))}
          </select>
        </label>
        {settings.cap_agreed && (
          <p className="text-xs text-[var(--text-secondary)]">{t('settings.pro.portfolio.agreedOn', { date: settings.cap_agreed.on })}</p>
        )}
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--text-primary)]">{t('settings.pro.portfolio.threshold')}</span>
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
          <span className="text-sm text-[var(--text-primary)]">{t('settings.pro.portfolio.ruleAgreedOn')}</span>
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

/** ISO weekdays (1 Monday to 7 Sunday) in the order of the account's week start. */
function weekdayOrder(weekStart: string): number[] {
  const first = weekStart === 'sunday' ? 7 : weekStart === 'saturday' ? 6 : 1
  return Array.from({ length: 7 }, (_unused, index) => ((first - 1 + index) % 7) + 1)
}

/** A weekday's name in the language the app is shown in (2024-01-01 was a Monday). */
function weekdayLabel(isoDay: number, language: string): string {
  return new Intl.DateTimeFormat(language, { weekday: 'long' }).format(new Date(2024, 0, isoDay, 12))
}

/** Follow-ups (21.18): when to check, which days count as working days, the weekly note, the text language. */
function FollowUpSettings() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { ledger } = useProLedger()
  const weekStart = useWeekStart()
  const settings = ledgerSettings(ledger)
  const write = (value: Record<string, unknown>) => void writeLedger(queryClient, [{ op: 'settings', value: { ...settings, ...value } }])
  const workdays = readWorkdays(settings.workdays)
  const noteDay = readNoteDay(settings.note_day)
  const language = textLanguage(null, settings)
  const languages = [...new Set(['en', language, ...availableLanguages(false)])]
  const order = weekdayOrder(weekStart)

  return (
    <div className={CARD} data-pro-follow-up-settings>
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">{t('settings.pro.followUps.title')}</h2>
      <p className="mb-4 text-xs text-[var(--text-secondary)]">{t('settings.pro.followUps.note')}</p>
      <div className="space-y-4">
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--text-primary)]">{t('settings.pro.followUps.checkDays')}</span>
          <input
            type="number"
            min={0}
            max={MAX_CHECK_DAYS}
            className={`${FIELD} w-20`}
            value={readCheckDays(settings.check_days ?? DEFAULT_CHECK_DAYS)}
            onChange={(event) => {
              const days = Math.floor(Number(event.target.value))
              if (event.target.value !== '' && days >= 0 && days <= MAX_CHECK_DAYS) write({ check_days: days })
            }}
          />
        </label>
        <fieldset>
          <legend className="mb-1 text-sm text-[var(--text-primary)]">{t('settings.pro.followUps.workdays')}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {order.map((day) => {
              const on = workdays.includes(day)
              return (
                <label key={day} className="flex items-center gap-1.5 text-sm text-[var(--text-primary)]">
                  <input
                    type="checkbox"
                    checked={on}
                    // At least one day stays ticked.
                    disabled={on && workdays.length === 1}
                    data-pro-workday={day}
                    onChange={(event) => {
                      const next = event.target.checked ? [...workdays, day] : workdays.filter((entry) => entry !== day)
                      if (next.length > 0) write({ workdays: [...new Set(next)].sort((a, b) => a - b) })
                    }}
                  />
                  {weekdayLabel(day, i18n.language)}
                </label>
              )
            })}
          </div>
        </fieldset>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--text-primary)]">{t('settings.pro.followUps.noteDay')}</span>
          <select
            className={FIELD}
            value={noteDay === null ? '' : String(noteDay)}
            onChange={(event) => write({ note_day: event.target.value === '' ? null : Number(event.target.value) })}
          >
            <option value="">{t('settings.pro.followUps.noteDayNone')}</option>
            {order.map((day) => <option key={day} value={String(day)}>{weekdayLabel(day, i18n.language)}</option>)}
          </select>
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--text-primary)]">{t('settings.pro.followUps.textLanguage')}</span>
          <select className={FIELD} value={language} onChange={(event) => write({ text_language: event.target.value })}>
            {languages.map((tag) => <option key={tag} value={tag}>{languageName(tag)}</option>)}
          </select>
        </label>
      </div>
    </div>
  )
}
