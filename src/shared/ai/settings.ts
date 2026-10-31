/**
 * The assistant's device settings (docs/ai-assistant-v1.md section 7.2): their default, their
 * normalizer, and the rules read from them (which address is local, whether consent is needed,
 * which features can run). Used by the main process, which owns them, and by Settings.
 */
import { AI_LIMITS, PROVIDER_PRESETS, providerPreset, speechModel, type ProviderId } from './contract'
import type { AiSettings, ConnectionTestResult, ModelCapabilities, ProviderSetup } from './types'

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: null,
  address: '',
  models: { dictation: '', ask: '' },
  features: { dictation: false, ask: false, talk: false },
  tested: {},
  consented: [],
  refusedFields: {},
  speech: { modelId: null, language: 'auto' },
  speakAnswers: true,
  brainDump: false,
  remembered: {},
  savedAddresses: {},
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
const withoutSlash = (address: string): string => address.trim().replace(/\/+$/, '')

function normaliseSetup(raw: unknown): ProviderSetup | null {
  if (!isObject(raw)) return null
  const models = isObject(raw.models) ? raw.models : {}
  return { address: withoutSlash(str(raw.address)), models: { dictation: str(models.dictation).trim(), ask: str(models.ask).trim() } }
}

const isProviderId = (id: string): id is ProviderId => !!providerPreset(id)

/** A settings object from disk or a window, with every field of the right type. */
export function normaliseAiSettings(raw: unknown): AiSettings {
  const o = isObject(raw) ? raw : {}
  const provider = typeof o.provider === 'string' && providerPreset(o.provider) ? o.provider as ProviderId : null
  const models = isObject(o.models) ? o.models : {}
  const features = isObject(o.features) ? o.features : {}
  const speech = isObject(o.speech) ? o.speech : {}
  const tested: Record<string, ModelCapabilities> = {}
  if (isObject(o.tested)) {
    for (const [key, value] of Object.entries(o.tested)) {
      if (!isObject(value)) continue
      const structured = value.structured === 'json_schema' || value.structured === 'prompt' ? value.structured : null
      tested[key] = { structured, tools: value.tools === true }
    }
  }
  const refusedFields: Record<string, string[]> = {}
  if (isObject(o.refusedFields)) {
    for (const [key, value] of Object.entries(o.refusedFields)) {
      if (Array.isArray(value)) refusedFields[key] = value.filter((v): v is string => typeof v === 'string')
    }
  }
  const remembered: AiSettings['remembered'] = {}
  if (isObject(o.remembered)) {
    for (const [id, value] of Object.entries(o.remembered)) {
      const setup = normaliseSetup(value)
      if (setup && isProviderId(id)) remembered[id] = setup
    }
  }
  const savedAddresses: AiSettings['savedAddresses'] = {}
  if (isObject(o.savedAddresses)) {
    for (const [id, value] of Object.entries(o.savedAddresses)) {
      if (!isProviderId(id) || !Array.isArray(value)) continue
      const list = value.map(normaliseSetup).filter((setup): setup is ProviderSetup => !!setup?.address)
      savedAddresses[id] = list.slice(0, AI_LIMITS.saved_addresses_max)
    }
  }
  const modelId = typeof speech.modelId === 'string' && speechModel(speech.modelId) ? speech.modelId : null
  const language = typeof speech.language === 'string' && /^(auto|[a-z]{2})$/.test(speech.language) ? speech.language : 'auto'
  return {
    provider,
    address: withoutSlash(str(o.address)),
    models: { dictation: str(models.dictation).trim(), ask: str(models.ask).trim() },
    features: { dictation: features.dictation === true, ask: features.ask === true, talk: features.talk === true },
    tested,
    consented: Array.isArray(o.consented) ? o.consented.filter((v): v is string => typeof v === 'string') : [],
    refusedFields,
    speech: { modelId, language },
    speakAnswers: o.speakAnswers !== false,
    brainDump: o.brainDump === true,
    remembered,
    savedAddresses,
  }
}

/** The address requests go to: the preset's own unless the user may type one. */
export function effectiveAddress(settings: Pick<AiSettings, 'provider' | 'address'>): string {
  const preset = settings.provider ? providerPreset(settings.provider) : undefined
  if (!preset) return ''
  return (preset.addressEditable ? settings.address || preset.address || '' : preset.address ?? '').replace(/\/+$/, '')
}

export function modelKey(settings: Pick<AiSettings, 'provider' | 'address'>, model: string): string {
  return `${settings.provider}|${effectiveAddress(settings)}|${model}`
}

export function consentKey(settings: Pick<AiSettings, 'provider' | 'address'>): string {
  return `${settings.provider}|${effectiveAddress(settings)}`
}

// --- What each preset remembers, saved addresses, keys per address (7.2) --------------------

export function sameAddress(a: string, b: string): boolean {
  return withoutSlash(a) === withoutSlash(b)
}

/** The id the key is stored under: the preset, and for a typed preset its address too; null without a preset. */
export function keyId(settings: Pick<AiSettings, 'provider' | 'address'>): string | null {
  const preset = settings.provider ? providerPreset(settings.provider) : undefined
  if (!preset) return null
  return preset.addressEditable ? `${preset.id}|${effectiveAddress(settings)}` : preset.id
}

/** The saved addresses of the preset in use. */
export function savedAddressesOf(settings: Pick<AiSettings, 'provider' | 'savedAddresses'>): ProviderSetup[] {
  return settings.provider ? settings.savedAddresses[settings.provider] ?? [] : []
}

/** Saves the address in use with its models, first in the list, at most `saved_addresses_max`. */
export function savingAddress(settings: AiSettings): AiSettings {
  const address = effectiveAddress(settings)
  if (!settings.provider || !address || !providerPreset(settings.provider)?.addressEditable) return settings
  const entry: ProviderSetup = { address, models: { ...settings.models } }
  const rest = savedAddressesOf(settings).filter((e) => !sameAddress(e.address, address))
  return { ...settings, savedAddresses: { ...settings.savedAddresses, [settings.provider]: [entry, ...rest].slice(0, AI_LIMITS.saved_addresses_max) } }
}

/** The saved entry of the address in use follows a model change. */
export function withSavedModels(settings: AiSettings): AiSettings {
  const address = effectiveAddress(settings)
  const list = savedAddressesOf(settings)
  if (!settings.provider || !list.some((e) => sameAddress(e.address, address))) return settings
  const next = list.map((e) => (sameAddress(e.address, address) ? { ...e, models: { ...settings.models } } : e))
  return { ...settings, savedAddresses: { ...settings.savedAddresses, [settings.provider]: next } }
}

/** Without the saved `address` of the preset in use; the address in use stays. */
export function withoutSavedAddress(settings: AiSettings, address: string): AiSettings {
  if (!settings.provider || sameAddress(address, effectiveAddress(settings))) return settings
  const next = savedAddressesOf(settings).filter((e) => !sameAddress(e.address, address))
  return { ...settings, savedAddresses: { ...settings.savedAddresses, [settings.provider]: next } }
}

/**
 * Another preset, or Off (null): what the one in use was set to is remembered, and the other's comes
 * back (7.2). The features start off; a preset with a fixed address uses the fixture's.
 */
export function choosingProvider(settings: AiSettings, id: ProviderId | null): AiSettings {
  if (settings.provider === id) return settings
  const remembered = { ...settings.remembered }
  if (settings.provider) remembered[settings.provider] = { address: settings.address, models: { ...settings.models } }
  const preset = id ? providerPreset(id) : undefined
  if (!preset) return { ...settings, provider: null, remembered, features: { dictation: false, ask: false, talk: false } }
  const back = remembered[preset.id]
  delete remembered[preset.id]
  // One model to start with: the preset's dictation suggestion (the quicker one), for Ask too.
  const model = preset.suggested.dictation ?? preset.suggested.ask ?? ''
  return {
    ...settings,
    provider: preset.id,
    address: preset.addressEditable ? back?.address ?? '' : preset.address ?? '',
    models: { dictation: back?.models.dictation || model, ask: back?.models.ask || model },
    features: { dictation: false, ask: false, talk: false },
    remembered,
  }
}

/** The typed presets, whose keys are stored per address. */
export function typedPresetIds(): ProviderId[] {
  return PROVIDER_PRESETS.filter((p) => p.addressEditable).map((p) => p.id)
}

/** The statuses that can mean a typed address lacks its version path (2.4). */
export const ADDRESS_HINT_STATUSES = [404, 405]

/**
 * A 404 or 405 from this typed address may mean its version path is missing (2.4): no path segment
 * starts with `v` and a digit, and the last one is not `api`.
 */
export function mayLackVersionPath(address: string): boolean {
  const trimmed = address.trim()
  const rest = trimmed.includes('://') ? trimmed.slice(trimmed.indexOf('://') + 3) : trimmed
  const segments = rest.split('?')[0].split('/').slice(1).filter(Boolean)
  if (segments.some((segment) => /^v\d/i.test(segment))) return false
  return segments.length === 0 || segments[segments.length - 1].toLowerCase() !== 'api'
}

/** The lower-case host of an address, or null. */
export function hostOf(address: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(address.trim())
  if (!match) return null
  const authority = match[1].slice(match[1].lastIndexOf('@') + 1)
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    return end > 0 ? authority.slice(1, end).toLowerCase() : null
  }
  const host = authority.split(':')[0].toLowerCase()
  return host || null
}

const LOCAL_SUFFIXES = ['.localhost', '.local', '.lan', '.home', '.internal', '.home.arpa', '.test']

/** A host on this computer or the local network: localhost, a private range, a `.local` name, a name without a dot. */
export function isLocalHost(host: string): boolean {
  if (host === 'localhost' || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true
  if (host.includes(':')) {
    if (host === '::1') return true
    const first = host.split(':')[0]
    return first.length === 4 && (first.startsWith('fc') || first.startsWith('fd') || (first.startsWith('fe') && '89ab'.includes(first[2])))
  }
  const parts = host.split('.')
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
    const [a, b] = parts.map(Number)
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
  }
  return !host.includes('.')
}

export function isLocalAddress(address: string): boolean {
  const host = hostOf(address)
  return host !== null && isLocalHost(host)
}

/** Plain http to a host outside the local network: the same warning the setup screen gives for a Vikunja server. */
export function isCleartextToRemoteHost(address: string): boolean {
  return /^http:\/\//i.test(address.trim()) && !isLocalAddress(address)
}

/**
 * Consent is asked before a cloud provider is first used (7.1); a local server (Ollama or Open
 * WebUI at a local address) skips it.
 */
export function needsConsent(settings: Pick<AiSettings, 'provider' | 'address'>): boolean {
  const preset = settings.provider ? providerPreset(settings.provider) : undefined
  if (!preset) return false
  const local = (preset.id === 'ollama' || preset.id === 'openwebui' || preset.id === 'other') && isLocalAddress(effectiveAddress(settings))
  return !local
}

export function hasConsent(settings: Pick<AiSettings, 'provider' | 'address' | 'consented'>): boolean {
  return !needsConsent(settings) || settings.consented.includes(consentKey(settings))
}

/** The provider is chosen with an address and, where the preset needs one, a key. */
export function isSetUp(settings: AiSettings, hasKey: boolean): boolean {
  const preset = settings.provider ? providerPreset(settings.provider) : undefined
  if (!preset || !effectiveAddress(settings)) return false
  return preset.key === 'optional' || hasKey
}

export function capabilitiesOf(settings: AiSettings, model: string): ModelCapabilities | undefined {
  return model ? settings.tested[modelKey(settings, model)] : undefined
}

/** Which features can run now: set up, consent given, switched on, and the model passed Test connection. */
export function readyFeatures(settings: AiSettings, hasKey: boolean): { dictation: boolean; ask: boolean; talk: boolean } {
  const base = isSetUp(settings, hasKey) && hasConsent(settings)
  const dictation = base && settings.features.dictation && !!capabilitiesOf(settings, settings.models.dictation)?.structured
  const askCaps = capabilitiesOf(settings, settings.models.ask)
  const ask = base && settings.features.ask && !!askCaps?.structured && askCaps.tools
  return { dictation, ask, talk: ask && settings.features.talk }
}

/** What a feature runs on: smart dictation, or Ask (Talk is Ask by voice). */
export type ModelFeature = 'dictation' | 'ask'

/** The models the features use, each once: the main (dictation) model, then Ask's when it differs. */
export function modelsInUse(settings: Pick<AiSettings, 'models'>): string[] {
  return [...new Set([settings.models.dictation, settings.models.ask].map((model) => model.trim()).filter(Boolean))]
}

/**
 * The models in use that have no Test connection result yet, while requests can go out (set up,
 * key saved or not needed). Settings tests these by itself after a model or a key is saved.
 */
export function untestedModels(settings: AiSettings, hasKey: boolean): string[] {
  if (!isSetUp(settings, hasKey)) return []
  return modelsInUse(settings).filter((model) => !capabilitiesOf(settings, model))
}

/** Whether a tested model can run the feature. */
export function canRunFeature(feature: ModelFeature, caps: ModelCapabilities | undefined): boolean {
  if (!caps?.structured) return false
  return feature === 'dictation' || caps.tools
}

/** The plain reason a model cannot run a feature, when the test gave no text of its own. */
export function featureNeeds(feature: ModelFeature, caps?: ModelCapabilities): string {
  if (feature === 'dictation') return 'Smart dictation needs a model that can give a structured answer. Choose another model.'
  if (caps && !caps.structured) return 'Ask needs a model that can give a structured answer. Choose another model.'
  return 'Ask needs a model that can call tools. Choose another model.'
}

/**
 * Why a Test connection result does not let a model run the feature, or null when it does: the
 * test's own first problem (the request failing, the structured answer, then the tool call), else
 * the plain reason.
 */
export function featureProblem(feature: ModelFeature, result: ConnectionTestResult | string): string | null {
  if (typeof result === 'string') return result.trim() || featureNeeds(feature)
  if (result.features[feature]) return null
  const problems = [!result.structured.ok ? result.structured.error : undefined, feature === 'ask' && !result.tool.ok ? result.tool.error : undefined]
  const first = problems.find((problem) => problem && problem.trim())
  if (first && result.hint) return `${first.trim()} ${result.hint}`
  return first?.trim() ?? featureNeeds(feature, { structured: result.structured.ok ? result.structured.mode : null, tools: result.tool.ok })
}
