import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Trans, useTranslation } from 'react-i18next'
import { CheckCircle2, Download, Loader2, Pause, Trash2, XCircle } from 'lucide-react'
import { Button } from '@/components/shared/Button'
import { Switch } from '@/components/shared/Switch'
import { Dialog } from '@/components/overlay/Dialog'
import { cn } from '@/lib/cn'
import { shortcutHint } from '@/lib/shortcut-hint'
import {
  AI_SETTINGS_QUERY_KEY,
  SPEECH_STATUS_QUERY_KEY,
  useAiReady,
  useAiSettings,
  useSaveAiSettings,
  useSpeechStatus,
} from '@/hooks/use-ai'
import { startTalk, useAskStore } from '@/stores/ask-store'
import { useDictationStore } from '@/stores/dictation-store'
import { toast } from '@/stores/toast-store'
import { SecretStorageNotice } from './SecretStorageNotice'
import { AI_MESSAGES, PROVIDER_PRESETS, SPEECH, providerPreset } from '../../../shared/ai/contract'
import {
  canRunFeature,
  capabilitiesOf,
  consentKey,
  effectiveAddress,
  featureNeeds,
  featureProblem,
  hasConsent,
  isCleartextToRemoteHost,
  isSetUp,
  sameAddress,
  savedAddressesOf,
  untestedModels,
  type ModelFeature,
} from '../../../shared/ai/settings'
import type { TranslationKey } from '../../../shared/i18n'
import type { AiSettingsPatch, AiSettingsView, ConnectionTestResult, SpeechDownloadProgress } from '../../../shared/ai/types'

const CARD = 'rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5'
const INPUT = 'w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]'
const LABEL = 'mb-1 block text-xs text-[var(--text-secondary)]'

const LANGUAGES: Array<[string, TranslationKey]> = [
  ['auto', 'settings.assistant.languages.auto'],
  ['en', 'settings.assistant.languages.en'],
  ['nl', 'settings.assistant.languages.nl'],
  ['de', 'settings.assistant.languages.de'],
  ['fr', 'settings.assistant.languages.fr'],
  ['es', 'settings.assistant.languages.es'],
  ['it', 'settings.assistant.languages.it'],
  ['pt', 'settings.assistant.languages.pt'],
  ['sv', 'settings.assistant.languages.sv'],
  ['da', 'settings.assistant.languages.da'],
  ['pl', 'settings.assistant.languages.pl'],
  ['cs', 'settings.assistant.languages.cs'],
  ['fi', 'settings.assistant.languages.fi'],
  ['ja', 'settings.assistant.languages.ja'],
  ['zh', 'settings.assistant.languages.zh'],
  ['ko', 'settings.assistant.languages.ko'],
  ['ru', 'settings.assistant.languages.ru'],
  ['uk', 'settings.assistant.languages.uk'],
]

function formatBytes(bytes: number): string {
  // i18n-ignore: unit symbols
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  return `${Math.round(bytes / 1e6)} MB`
}

/**
 * Settings, Assistant (docs/ai-assistant-v1.md sections 2, 3 and 7), in the two halves the
 * assistant has: Thinking (the provider, its address and key, the model, Test connection, the
 * consent sheet) and Hearing (local speech's models). Between them the features, each with where
 * to find it and Try it. A model is tested by itself once it is chosen and requests can go out, and
 * when a feature that needs it is turned on. Everything here belongs to this device: it is not
 * synced and stays when you sign out; the key is kept by the main process in the system's secret
 * store and never shown again.
 */
export function AssistantSettings() {
  const { data: settings } = useAiSettings()
  const tests = useModelTests(settings)
  if (!settings) return null
  return (
    <>
      <ThinkingCard settings={settings} tests={tests} />
      <FeaturesCard settings={settings} tests={tests} />
      <SpeechCard settings={settings} />
      <PrivacyCard />
      {tests.consentDialog}
    </>
  )
}

type TestOutcome = ConnectionTestResult | string

interface ConsentRequest {
  view: AiSettingsView
  agree: () => void
  cancel: () => void
}

interface ModelTests {
  /** Models whose test is running. */
  testing: ReadonlySet<string>
  /** The latest result per model while Settings is open. */
  results: Record<string, TestOutcome>
  /** Tests these models (asking for consent first, 7.1); null when the user did not agree. */
  run: (view: AiSettingsView, models: string[]) => Promise<Record<string, TestOutcome> | null>
  /** After a model, key, address or provider was saved: tests the models in use that have no result yet. */
  testUntested: (view: AiSettingsView) => void
  /** Runs `action` once the user agreed to send data to this provider; a local server skips it. */
  withConsent: (view: AiSettingsView, action: () => void, onCancel?: () => void) => void
  consentDialog: React.ReactNode
}

/** Test connection for Settings: one run per model at a time, the results kept for the cards. */
function useModelTests(settings: AiSettingsView | undefined): ModelTests {
  const { t } = useTranslation()
  const save = useSaveAiSettings()
  const qc = useQueryClient()
  const [testing, setTesting] = useState<ReadonlySet<string>>(new Set())
  const [results, setResults] = useState<Record<string, TestOutcome>>({})
  const [consent, setConsent] = useState<ConsentRequest | null>(null)
  /** The question on screen, mirrored so a newer one can answer the older with a cancel. */
  const asking = useRef<ConsentRequest | null>(null)
  const running = useRef(new Map<string, Promise<TestOutcome>>())

  const testOne = (model: string): Promise<TestOutcome> => {
    const current = running.current.get(model)
    if (current) return current
    const promise = window.api.ai.testConnection(model)
      .then((result): TestOutcome => (result.success ? result.data : result.error.message))
      .catch((err: unknown): TestOutcome => (err instanceof Error ? err.message : t('settings.assistant.testFailed')))
      .then(async (outcome) => {
        running.current.delete(model)
        setTesting(new Set(running.current.keys()))
        setResults((all) => ({ ...all, [model]: outcome }))
        await qc.invalidateQueries({ queryKey: AI_SETTINGS_QUERY_KEY })
        return outcome
      })
    running.current.set(model, promise)
    setTesting(new Set(running.current.keys()))
    return promise
  }

  const ask = (next: ConsentRequest | null) => {
    asking.current = next
    setConsent(next)
  }

  const withConsent = (view: AiSettingsView, action: () => void, onCancel: () => void = () => {}) => {
    if (hasConsent(view)) {
      action()
      return
    }
    asking.current?.cancel()
    ask({ view, agree: action, cancel: onCancel })
  }

  const run = (view: AiSettingsView, models: string[]) => new Promise<Record<string, TestOutcome> | null>((resolve) => {
    const wanted = [...new Set(models.map((m) => m.trim()).filter(Boolean))]
    withConsent(view, () => {
      void (async () => {
        const out: Record<string, TestOutcome> = {}
        for (const model of wanted) out[model] = await testOne(model)
        resolve(out)
      })()
    }, () => resolve(null))
  })

  const preset = consent?.view.provider ? providerPreset(consent.view.provider) : undefined
  const consentDialog = (
    <ConsentDialog
      open={consent !== null}
      providerName={preset?.name ?? t('settings.assistant.consent.theProvider')}
      onCancel={() => {
        consent?.cancel()
        ask(null)
      }}
      onAgree={async () => {
        const pending = consent
        ask(null)
        if (!pending) return
        await save({ consented: [...new Set([...(settings?.consented ?? pending.view.consented), consentKey(pending.view)])] })
        pending.agree()
      }}
    />
  )

  return {
    testing,
    results,
    run,
    testUntested: (view) => {
      const models = untestedModels(view, view.hasKey)
      if (models.length > 0) void run(view, models)
    },
    withConsent,
    consentDialog,
  }
}

function ThinkingCard({ settings, tests }: { settings: AiSettingsView; tests: ModelTests }) {
  const { t } = useTranslation()
  const save = useSaveAiSettings()
  const qc = useQueryClient()
  const preset = settings.provider ? providerPreset(settings.provider) : undefined
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)

  // What the preset was set to before comes back; a new one starts with its suggested model (7.2).
  const chooseProvider = async (id: string) => {
    const view = await window.api.ai.chooseProvider(id || null)
    qc.setQueryData(AI_SETTINGS_QUERY_KEY, view)
    if (view.provider) tests.testUntested(view)
  }

  const saveKey = async (value: string | null) => {
    const view = await window.api.ai.setKey(value)
    qc.setQueryData(AI_SETTINGS_QUERY_KEY, view)
    setKey('')
    toast.success(value ? t('settings.assistant.thinking.keySaved') : t('settings.assistant.thinking.keyRemoved'))
    if (value) tests.testUntested(view)
  }


  return (
    <section className={CARD} aria-labelledby="ai-provider-heading">
      <h2 id="ai-provider-heading" className="mb-1 text-sm font-semibold text-[var(--text-primary)]">{t('settings.assistant.thinking.title')}</h2>
      <p className="text-xs text-[var(--text-primary)]">
        {t('settings.assistant.thinking.intro')}
      </p>
      <p className="mb-4 mt-1 text-xs text-[var(--text-secondary)]">
        {t('settings.assistant.thinking.requests')}
      </p>
      <div className="space-y-3">
        <div>
          <label className={LABEL} htmlFor="ai-provider">{t('settings.assistant.thinking.provider')}</label>
          <select
            id="ai-provider"
            value={settings.provider ?? ''}
            onChange={(e) => void chooseProvider(e.target.value)}
            className="rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
          >
            <option value="">{t('settings.assistant.thinking.off')}</option>
            {PROVIDER_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {preset && (
          <>
            {preset.addressEditable ? (
              <TypedAddress key={settings.provider} settings={settings} tests={tests} />
            ) : (
              <div>
                <label className={LABEL} htmlFor="ai-address">{t('settings.assistant.address')}</label>
                <input
                  id="ai-address"
                  type="url"
                  value={effectiveAddress(settings)}
                  disabled
                  className={cn(INPUT, 'text-[var(--text-secondary)]')}
                />
              </div>
            )}

            <div>
              <label className={LABEL} htmlFor="ai-key">
                {preset.key === 'optional' ? t('settings.assistant.thinking.keyOptional') : t('settings.assistant.thinking.key')}
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    id="ai-key"
                    type={showKey ? 'text' : 'password'}
                    value={key}
                    autoComplete="off"
                    placeholder={settings.hasKey ? t('settings.assistant.thinking.keyPlaceholderSaved') : t('settings.assistant.thinking.keyPlaceholder')}
                    onChange={(e) => setKey(e.target.value)}
                    className={cn(INPUT, 'pr-16')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 inline-flex min-h-6 -translate-y-1/2 items-center rounded-control px-2 py-0.5 text-meta text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    {showKey ? t('settings.assistant.thinking.hide') : t('settings.assistant.thinking.show')}
                  </button>
                </div>
                <Button variant="secondary" disabled={!key.trim()} onClick={() => void saveKey(key)}>{t('settings.assistant.thinking.saveKey')}</Button>
                {settings.hasKey && <Button variant="quiet" danger onClick={() => void saveKey(null)}>{t('settings.assistant.remove')}</Button>}
              </div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                {t('settings.assistant.thinking.keyNote')}
              </p>
              <SecretStorageNotice subject="key" />
            </div>

            <ModelFields settings={settings} tests={tests} />
          </>
        )}
      </div>
    </section>
  )
}

function CleartextWarning({ address }: { address: string }) {
  const { t } = useTranslation()
  if (!isCleartextToRemoteHost(address)) return null
  return (
    <p className="mt-1 text-xs text-danger" role="alert">
      {t('settings.assistant.cleartext')}
    </p>
  )
}

/**
 * The address of a typed preset (2.1, 7.2): saved, it shows as a value with Edit, and the saved
 * addresses are listed to pick or remove; Add address saves another one next to it.
 */
function TypedAddress({ settings, tests }: { settings: AiSettingsView; tests: ModelTests }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const current = effectiveAddress(settings)
  const saved = savedAddressesOf(settings)
  const [mode, setMode] = useState<'edit' | 'add' | null>(null)
  const [draft, setDraft] = useState('')
  const editing = mode ?? (current ? null : 'edit')
  const helpId = useId()

  const show = (view: AiSettingsView) => qc.setQueryData(AI_SETTINGS_QUERY_KEY, view)
  const start = (next: 'edit' | 'add') => {
    setDraft(next === 'edit' ? current : '')
    setMode(next)
  }
  const submit = async () => {
    if (!draft.trim()) return
    const view = await window.api.ai.saveAddress(draft, editing === 'edit')
    show(view)
    setMode(null)
    tests.testUntested(view)
  }
  const pick = async (address: string) => {
    const view = await window.api.ai.useSavedAddress(address)
    show(view)
    tests.testUntested(view)
  }
  const remove = async (address: string) => show(await window.api.ai.removeSavedAddress(address))

  if (editing) {
    return (
      <div>
        <label className={LABEL} htmlFor="ai-address">{editing === 'add' ? t('settings.assistant.typed.newAddress') : t('settings.assistant.address')}</label>
        <div className="flex gap-2">
          <input
            id="ai-address"
            type="url"
            value={draft}
            // i18n-ignore: an address example
            placeholder="http://192.168.1.10:1234/v1"
            aria-describedby={helpId}
            autoFocus={mode !== null}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
              if (e.key === 'Escape' && current) setMode(null)
            }}
            className={cn(INPUT, 'flex-1')}
          />
          <Button variant="secondary" disabled={!draft.trim()} onClick={() => void submit()}>{t('settings.assistant.typed.saveAddress')}</Button>
          {current && <Button variant="quiet" onClick={() => setMode(null)}>{t('settings.assistant.cancel')}</Button>}
        </div>
        <p id={helpId} className="mt-1 text-xs text-[var(--text-secondary)]">{AI_MESSAGES.addressHelp}</p>
        <CleartextWarning address={draft} />
      </div>
    )
  }

  return (
    <div>
      <p className={LABEL}>{t('settings.assistant.address')}</p>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]" title={current}>{current}</span>
        <Button variant="secondary" onClick={() => start('edit')}>{t('settings.assistant.typed.edit')}</Button>
        <Button variant="quiet" onClick={() => start('add')}>{t('settings.assistant.typed.addAddress')}</Button>
      </div>
      <CleartextWarning address={current} />
      {saved.length > 1 && (
        <div className="mt-2">
          <p className="text-xs text-[var(--text-secondary)]">{t('settings.assistant.typed.savedAddresses')}</p>
          <ul className="mt-1 space-y-1">
            {saved.map((entry) => {
              const inUse = sameAddress(entry.address, current)
              return (
                <li key={entry.address} className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-current={inUse ? 'true' : undefined}
                    disabled={inUse}
                    onClick={() => void pick(entry.address)}
                    className={cn(
                      'min-w-0 flex-1 truncate rounded-control px-2 py-1 text-left text-xs',
                      inUse ? 'bg-bg-selected text-text' : 'text-text hover:bg-bg-hover',
                    )}
                  >
                    {entry.address}
                    {entry.models.dictation && <span className="text-[var(--text-secondary)]"> · {entry.models.dictation}</span>}
                    {inUse && <span className="text-[var(--text-secondary)]"> · {t('settings.assistant.typed.inUse')}</span>}
                  </button>
                  {!inUse && (
                    <Button variant="quiet" aria-label={t('settings.assistant.typed.removeAddress', { address: entry.address })} onClick={() => void remove(entry.address)}>{t('settings.assistant.remove')}</Button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * The model: one for dictation and Ask (`models.dictation` and `models.ask` the same), unless "Use a
 * different model for Ask" is on. A stored Ask model that differs shows the switch on; turning it
 * off gives Ask the main model again. A saved model without a test result is tested at once.
 */
function ModelFields({ settings, tests }: { settings: AiSettingsView; tests: ModelTests }) {
  const { t, i18n } = useTranslation()
  const save = useSaveAiSettings()
  const preset = settings.provider ? providerPreset(settings.provider) : undefined
  const [models, setModels] = useState<string[] | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [mainModel, setMainModel] = useState(settings.models.dictation)
  const [askModel, setAskModel] = useState(settings.models.ask)
  const [separate, setSeparate] = useState(settings.models.ask !== settings.models.dictation)
  const listId = useId()
  // Each field follows its own saved value only, so saving one never clears what is being typed in the other.
  useEffect(() => setMainModel(settings.models.dictation), [settings.models.dictation])
  useEffect(() => setAskModel(settings.models.ask), [settings.models.ask])
  useEffect(() => {
    if (settings.models.ask !== settings.models.dictation) setSeparate(true)
  }, [settings.models.ask, settings.models.dictation])

  if (!preset) return null
  const setUp = isSetUp(settings, settings.hasKey)
  const askInUse = separate ? askModel : mainModel

  const saveModels = (patch: AiSettingsPatch['models']) => void save({ models: patch }).then(tests.testUntested)

  const saveMain = () => {
    const model = mainModel.trim()
    if (model === settings.models.dictation && (separate || model === settings.models.ask)) return
    saveModels(separate ? { dictation: model } : { dictation: model, ask: model })
  }

  const chooseSeparate = (on: boolean) => {
    setSeparate(on)
    if (!on && settings.models.ask !== settings.models.dictation) saveModels({ ask: settings.models.dictation })
  }

  const loadModels = () => tests.withConsent(settings, () => {
    void (async () => {
      setLoadingModels(true)
      setModelError(null)
      const result = await window.api.ai.listModels()
      setLoadingModels(false)
      if (result.success) setModels(result.data)
      else setModelError(result.error.message)
    })()
  })

  const shownModels = [...new Set([mainModel, askInUse].map((m) => m.trim()).filter(Boolean))]
  const testing = shownModels.filter((model) => tests.testing.has(model))

  const askSuggestion = preset.suggested.ask && preset.suggested.ask !== mainModel.trim() ? preset.suggested.ask : null

  return (
    <div className="space-y-3 border-t border-[var(--border-color)] pt-3">
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={!setUp || loadingModels} onClick={loadModels}>
          {loadingModels ? t('settings.assistant.model.loading') : t('settings.assistant.model.load')}
        </Button>
        {models && <span className="text-xs text-[var(--text-secondary)]">{t('settings.assistant.model.count', { count: models.length })}</span>}
        {modelError && <span className="text-xs text-danger">{t('settings.assistant.model.loadError', { error: modelError })}</span>}
      </div>
      <datalist id={listId}>{(models ?? []).map((m) => <option key={m} value={m} />)}</datalist>
      <div>
        <label className={LABEL} htmlFor="ai-model">{t('settings.assistant.model.model')}</label>
        <input
          id="ai-model"
          list={listId}
          value={mainModel}
          placeholder={preset.suggested.dictation ?? preset.suggested.ask ?? t('settings.assistant.model.modelName')}
          onChange={(e) => setMainModel(e.target.value)}
          onBlur={saveMain}
          className={INPUT}
        />
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          {separate ? t('settings.assistant.model.usedDictation') : t('settings.assistant.model.usedAll')}
        </p>
      </div>
      <label className="flex items-center justify-between gap-4">
        <span className="text-sm text-[var(--text-primary)]">{t('settings.assistant.model.useDifferent')}</span>
        <Switch checked={separate} onCheckedChange={chooseSeparate} />
      </label>
      {separate && (
        <div>
          <label className={LABEL} htmlFor="ai-model-ask">{t('settings.assistant.model.askModel')}</label>
          <input
            id="ai-model-ask"
            list={listId}
            value={askModel}
            placeholder={preset.suggested.ask ?? t('settings.assistant.model.modelName')}
            onChange={(e) => setAskModel(e.target.value)}
            onBlur={() => { if (askModel.trim() !== settings.models.ask) saveModels({ ask: askModel.trim() }) }}
            className={INPUT}
          />
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {askSuggestion ? t('settings.assistant.model.usedAskSuggested', { model: askSuggestion }) : t('settings.assistant.model.usedAsk')}
          </p>
        </div>
      )}

      <div>
        <Button variant="primary" disabled={!setUp || testing.length > 0 || shownModels.length === 0} onClick={() => void tests.run(settings, shownModels)}>
          {testing.length > 0 ? t('settings.assistant.model.testing') : t('settings.assistant.model.test')}
        </Button>
        <p className="mt-1 text-xs text-[var(--text-secondary)]" role="status">
          {!setUp
            ? (preset.key === 'required' && !settings.hasKey ? t('settings.assistant.model.saveKeyFirst') : t('settings.assistant.model.enterAddressFirst'))
            : testing.length > 0 ? t('settings.assistant.model.testingModels', { models: new Intl.ListFormat(i18n.language === 'en' ? 'en-GB' : i18n.language, { type: 'conjunction' }).format(testing) }) : t('settings.assistant.model.autoTest')}
        </p>
        {shownModels.filter((model) => tests.results[model] !== undefined).map((model) => <TestResult key={model} model={model} result={tests.results[model]} />)}
      </div>
    </div>
  )
}

/**
 * The features, each with where to find it and Try it (on once it can run). Turning one on whose
 * model has no passing test result tests it first and turns it on when it passes; a model that
 * cannot run it says why, and turning it on again tests again (a model that could not be reached
 * is stored as unable). Quick capture (hold + and let go) needs none of them and is never sent to
 * the model.
 */
function FeaturesCard({ settings, tests }: { settings: AiSettingsView; tests: ModelTests }) {
  const { t } = useTranslation()
  const save = useSaveAiSettings()
  const ready = useAiReady()
  const preset = settings.provider ? providerPreset(settings.provider) : undefined
  const setUp = isSetUp(settings, settings.hasKey)
  const askKeys = shortcutHint('Mod+J', window.api.platform === 'darwin')

  const stateOf = (feature: ModelFeature) => {
    const model = (feature === 'dictation' ? settings.models.dictation : settings.models.ask).trim()
    const caps = capabilitiesOf(settings, model)
    const result = model ? tests.results[model] : undefined
    const can = canRunFeature(feature, caps)
    let blocked: string | null = null
    if (!preset) blocked = t('settings.assistant.features.blockedProvider')
    else if (!setUp) blocked = preset.key === 'required' && !settings.hasKey ? t('settings.assistant.features.blockedKey') : t('settings.assistant.features.blockedAddress')
    else if (!model) blocked = t('settings.assistant.features.blockedModel')
    const testing = model !== '' && tests.testing.has(model)
    let problem: string | null = null
    if (!blocked && !testing) {
      if (caps && !can) problem = (result !== undefined ? featureProblem(feature, result) : null) ?? featureNeeds(feature, caps)
      // The test could not run at all (a refused key): the model stays untested.
      else if (!caps && typeof result === 'string') problem = featureProblem(feature, result)
    }
    return { model, can, blocked, testing, problem }
  }

  /** On: at once when the model can run it, else after its test passes. */
  const turnOn = async (feature: ModelFeature, patch: AiSettingsPatch['features']) => {
    const state = stateOf(feature)
    if (state.can) {
      await save({ features: patch })
      return
    }
    const outcome = await tests.run(settings, [state.model])
    const result = outcome?.[state.model]
    if (result !== undefined && featureProblem(feature, result) === null) await save({ features: patch })
  }

  const dictation = stateOf('dictation')
  const ask = stateOf('ask')
  const talkBlocked = ask.blocked ?? (!settings.features.ask || !ask.can ? t('settings.assistant.features.turnOnAsk') : null)

  return (
    <section className={CARD} aria-labelledby="ai-features-heading">
      <h2 id="ai-features-heading" className="mb-1 text-sm font-semibold text-[var(--text-primary)]">{t('settings.assistant.features.title')}</h2>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">
        {t('settings.assistant.features.intro')}
      </p>
      <div className="space-y-3">
        <FeatureRow
          label={t('settings.assistant.features.dictation')}
          how={t('settings.assistant.features.dictationHow')}
          blocked={dictation.blocked}
          testing={dictation.testing ? dictation.model : null}
          problem={dictation.problem}
          checked={settings.features.dictation && dictation.can}
          onChange={(on) => void (on ? turnOn('dictation', { dictation: true }) : save({ features: { dictation: false } }))}
          onTry={ready.dictation ? () => useDictationStore.getState().startLive() : null}
        />
        <FeatureRow
          label={t('settings.assistant.features.brainDump')}
          how={t('settings.assistant.features.brainDumpHow')}
          blocked={dictation.blocked ?? (!settings.features.dictation || !dictation.can ? t('settings.assistant.features.turnOnDictation') : null)}
          testing={null}
          problem={null}
          onTry={ready.dictation ? () => useDictationStore.getState().startLive({ brainDump: true }) : null}
        />
        <FeatureRow
          label={t('settings.assistant.features.ask')}
          how={t('settings.assistant.features.askHow', { keys: askKeys })}
          blocked={ask.blocked}
          testing={ask.testing ? ask.model : null}
          problem={ask.problem}
          checked={settings.features.ask && ask.can}
          onChange={(on) => void (on ? turnOn('ask', { ask: true }) : save({ features: { ask: false } }))}
          onTry={ready.ask ? () => useAskStore.getState().setOpen(true) : null}
        />
        <FeatureRow
          label={t('settings.assistant.features.talk')}
          how={t('settings.assistant.features.talkHow')}
          blocked={talkBlocked}
          testing={null}
          problem={null}
          checked={settings.features.talk && settings.features.ask && ask.can}
          onChange={(on) => void save({ features: { talk: on } })}
          onTry={ready.talk ? () => startTalk() : null}
        />
      </div>
    </section>
  )
}

interface FeatureRowProps {
  label: string
  how: string
  /** Why it cannot be turned on, or null. */
  blocked: string | null
  /** The model being tested for it, or null. */
  testing: string | null
  /** Why its model cannot run it, or why the test could not run; turning it on tests again. */
  problem: string | null
  /** The feature's switch; a feature without one (Brain dump: a switch in its sheet) leaves both out. */
  checked?: boolean
  onChange?: (on: boolean) => void
  /** Opens the feature; null while it cannot run. */
  onTry: (() => void) | null
}

function FeatureRow({ label, how, blocked, testing, problem, checked, onChange, onTry }: FeatureRowProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-start justify-between gap-4" data-feature={label}>
      <div className="min-w-0">
        <p className={cn('text-sm', blocked ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]')}>{label}</p>
        <p className="text-xs text-[var(--text-secondary)]">{how}</p>
        <p role="status" className={cn('text-xs', problem && !testing && !blocked ? 'text-danger' : 'text-[var(--text-secondary)]')}>
          {testing ? (
            <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> {t('settings.assistant.features.testing', { model: testing })}</span>
          ) : blocked ?? problem}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {onTry && <Button variant="secondary" aria-label={t('settings.assistant.features.tryLabel', { label })} onClick={onTry}>{t('settings.assistant.features.tryIt')}</Button>}
        {onChange && <Switch aria-label={label} checked={checked === true} disabled={blocked !== null || testing !== null} onCheckedChange={onChange} />}
      </div>
    </div>
  )
}

function TestResult({ model, result }: { model: string; result: ConnectionTestResult | string }) {
  const { t, i18n } = useTranslation()
  if (typeof result === 'string') return <p className="mt-2 text-xs text-danger">{model}: {result}</p>
  const row = (ok: boolean, text: string) => (
    <li className="flex items-center gap-1.5">
      {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-status-done" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5 text-danger" aria-hidden="true" />}
      <span className="sr-only">{ok ? t('settings.assistant.result.passed') : t('settings.assistant.result.failed')}</span>
      {text}
    </li>
  )
  const features = [result.features.dictation && t('settings.assistant.result.dictation'), result.features.ask && t('settings.assistant.result.ask'), result.features.talk && t('settings.assistant.result.talk')].filter(Boolean) as string[]
  return (
    <div className="mt-2 rounded-control border border-[var(--border-color)] p-3 text-xs text-[var(--text-primary)]">
      <p className="mb-1 font-medium">{model}</p>
      <ul className="space-y-0.5">
        {row(result.models.ok, result.models.ok ? t('settings.assistant.result.modelList', { n: result.models.count }) : t('settings.assistant.result.modelListError', { error: result.models.error ?? t('settings.assistant.result.notAvailable') }))}
        {row(result.structured.ok, result.structured.ok ? (result.structured.mode === 'prompt' ? t('settings.assistant.result.structuredPrompt') : t('settings.assistant.result.structuredStrict')) : t('settings.assistant.result.structuredError', { error: result.structured.error ?? t('settings.assistant.result.failedShort') }))}
        {row(result.tool.ok, result.tool.ok ? t('settings.assistant.result.toolCall') : t('settings.assistant.result.toolCallError', { error: result.tool.error ?? t('settings.assistant.result.failedShort') }))}
      </ul>
      <p className="mt-1 text-[var(--text-secondary)]">{features.length ? t('settings.assistant.result.canRun', { features: new Intl.ListFormat(i18n.language === 'en' ? 'en-GB' : i18n.language, { type: 'unit' }).format(features) }) : t('settings.assistant.result.canRunNone')}</p>
      {result.hint && <p className="mt-1 text-[var(--text-secondary)]">{result.hint}</p>}
    </div>
  )
}

/** What each feature sends (7.1), asked before a cloud provider is first used. */
function ConsentDialog({ open, providerName, onAgree, onCancel }: { open: boolean; providerName: string; onAgree: () => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const titleId = useId()
  return (
    <Dialog open={open} onClose={onCancel} labelledBy={titleId} className="w-[480px] max-w-[92vw]">
      <div className="space-y-3 p-5 text-sm text-[var(--text-primary)]">
        <h2 id={titleId} className="text-card-title">{t('settings.assistant.consent.title', { provider: providerName })}</h2>
        <p className="text-xs text-[var(--text-secondary)]">{t('settings.assistant.consent.intro', { provider: providerName })}</p>
        <ul className="list-disc space-y-1 pl-5 text-xs">
          <li><Trans i18nKey="settings.assistant.consent.dictation" components={{ strong: <strong /> }} /></li>
          <li><Trans i18nKey="settings.assistant.consent.ask" components={{ strong: <strong /> }} /></li>
        </ul>
        <p className="text-xs text-[var(--text-secondary)]">
          {t('settings.assistant.consent.neverSent')}
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="quiet" onClick={onCancel}>{t('settings.assistant.cancel')}</Button>
          <Button variant="primary" data-autofocus="" onClick={onAgree}>{t('settings.assistant.consent.agree')}</Button>
        </div>
      </div>
    </Dialog>
  )
}

function SpeechCard({ settings }: { settings: AiSettingsView }) {
  const { t } = useTranslation()
  const { data: status } = useSpeechStatus()
  const save = useSaveAiSettings()
  const qc = useQueryClient()
  const [progress, setProgress] = useState<Record<string, SpeechDownloadProgress>>({})
  useEffect(() => window.api.speech.onDownloadProgress((p) => {
    setProgress((current) => ({ ...current, [p.id]: p }))
    if (p.done || p.error) void qc.invalidateQueries({ queryKey: SPEECH_STATUS_QUERY_KEY })
  }), [qc])
  const states = useMemo(() => new Map((status?.models ?? []).map((m) => [m.id, m])), [status])

  const refresh = () => qc.invalidateQueries({ queryKey: SPEECH_STATUS_QUERY_KEY })

  return (
    <section className={CARD} aria-labelledby="ai-speech-heading">
      <h2 id="ai-speech-heading" className="mb-1 text-sm font-semibold text-[var(--text-primary)]">{t('settings.assistant.speech.title')}</h2>
      <p className="text-xs text-[var(--text-primary)]">
        {window.api.platform === 'linux' ? t('settings.assistant.speech.introLinux') : t('settings.assistant.speech.intro')}
      </p>
      <p className="mb-3 mt-1 text-xs text-[var(--text-secondary)]">
        {t('settings.assistant.speech.usedBy')}
      </p>
      {status && !status.engine && (
        <p className="mb-3 text-xs text-danger">{t('settings.assistant.speech.notInBuild')}</p>
      )}
      <ul className="space-y-2">
        {SPEECH.models.map((model) => {
          const state = states.get(model.id)
          const live = progress[model.id]
          const downloading = state?.downloading || (live && !live.done && !live.error)
          const bytes = live?.downloadedBytes ?? state?.downloadedBytes ?? 0
          const active = status?.activeModelId === model.id
          return (
            <li key={model.id} className="flex items-center gap-3 rounded-control border border-[var(--border-color)] px-3 py-2">
              <input
                type="radio"
                name="speech-model"
                aria-label={t('settings.assistant.speech.use', { label: model.label })}
                checked={settings.speech.modelId === model.id}
                disabled={!state?.downloaded}
                onChange={() => void save({ speech: { modelId: model.id } }).then(refresh)}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[var(--text-primary)]">
                  {model.label}
                  {model.default_for.includes('computer') && <span className="ml-2 text-xs text-accent-blue">{t('settings.assistant.speech.suggested')}</span>}
                  {active && <span className="ml-2 text-xs text-status-done">{t('settings.assistant.speech.inUse')}</span>}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {formatBytes(model.size)} · {model.language_codes ? t('settings.assistant.speech.europeanLanguages', { count: model.language_count }) : t('settings.assistant.speech.languages', { count: model.language_count })} · {model.license}
                  {model.attribution && <> · {model.attribution}</>}
                </p>
                {downloading && <p className="text-xs text-[var(--text-secondary)]" role="status">{t('settings.assistant.speech.downloading', { percent: Math.round((bytes / model.size) * 100) })}</p>}
                {!downloading && !state?.downloaded && bytes > 0 && <p className="text-xs text-[var(--text-secondary)]">{t('settings.assistant.speech.pausedAt', { percent: Math.round((bytes / model.size) * 100) })}</p>}
                {(live?.error && live.error !== 'Paused.' ? live.error : state?.error) && <p className="text-xs text-danger">{live?.error ?? state?.error}</p>}
              </div>
              {state?.downloaded ? (
                <Button variant="quiet" danger aria-label={t('settings.assistant.speech.deleteLabel', { label: model.label })} onClick={() => void window.api.speech.deleteModel(model.id).then(refresh).then(() => qc.invalidateQueries({ queryKey: AI_SETTINGS_QUERY_KEY }))}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> {t('settings.assistant.speech.delete')}
                </Button>
              ) : downloading ? (
                <Button variant="secondary" onClick={() => void window.api.speech.cancelDownload(model.id).then(refresh)}>
                  <Pause className="h-4 w-4" aria-hidden="true" /> {t('settings.assistant.speech.pause')}
                </Button>
              ) : (
                <Button variant="secondary" disabled={status ? !status.engine : true} onClick={() => {
                  setProgress((current) => ({ ...current, [model.id]: { id: model.id, downloadedBytes: bytes, totalBytes: model.size, done: false } }))
                  void window.api.speech.download(model.id).then(refresh)
                }}>
                  {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" aria-hidden="true" />} {bytes > 0 ? t('settings.assistant.speech.resume') : t('settings.assistant.speech.download')}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      <div className="mt-3">
        <label className={LABEL} htmlFor="speech-language">{t('settings.assistant.speech.language')}</label>
        <select
          id="speech-language"
          value={settings.speech.language}
          onChange={(e) => void save({ speech: { language: e.target.value } })}
          className="rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
        >
          {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{t(name)}</option>)}
        </select>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">{t('settings.assistant.speech.parakeet')}</p>
      </div>
    </section>
  )
}

function PrivacyCard() {
  const { t } = useTranslation()
  const clear = async () => {
    await window.api.ai.saveConversations([])
    useAskStore.setState({ conversations: [], currentId: null })
    toast.success(t('settings.assistant.privacy.deleted'))
  }
  return (
    <section className={CARD} aria-labelledby="ai-privacy-heading">
      <h2 id="ai-privacy-heading" className="mb-1 text-sm font-semibold text-[var(--text-primary)]">{t('settings.assistant.privacy.title')}</h2>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">
        {t('settings.assistant.privacy.text')}
      </p>
      <Button variant="secondary" danger onClick={() => void clear()}>{t('settings.assistant.privacy.delete')}</Button>
    </section>
  )
}

