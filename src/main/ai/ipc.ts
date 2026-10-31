import { handleTrusted } from '../secure-ipc'
import type { AiSettingsPatch, AskTurnRequest, KeptTranscript } from '../../shared/ai/types'
import { clearAiAccountData, dropKeptTranscript, flushAiLocalData, getConversations, getKeptTranscripts, keepTranscript, saveConversations } from './local-data'
import { aiAskTurn, aiBrainDump, aiDictate, aiListModels, aiOrganize, aiTestConnection, cancelAllAskTurns, cancelAskTurn } from './service'
import { providerPreset, type ProviderId } from '../../shared/ai/contract'
import {
  aiSettingsView,
  chooseAiProvider,
  flushAiSettings,
  patchAiSettings,
  removeSavedAddress,
  saveTypedAddress,
  setProviderKey,
  useSavedAddress,
} from './settings-store'
import {
  cancelModelDownload,
  cancelSpeechSession,
  deleteSpeechModel,
  feedSpeechAudio,
  shutdownSpeech,
  speechStatus,
  startModelDownload,
  startSpeechSession,
  stopSpeechSession,
} from './speech/service'

// The assistant's IPC (docs/ai-assistant-v1.md; CLAUDE.md, AI assistant). Provider requests run
// here, where the key is; the windows build the prompts' user messages from the fixture and run
// the checks and the tools. Every handler goes through handleTrusted.

const dictations = new Map<string, AbortController>()

export function registerAiIpc(): void {
  handleTrusted('ai:get-settings', () => aiSettingsView())
  handleTrusted('ai:save-settings', async (_event, patch: AiSettingsPatch) => {
    await patchAiSettings(patch && typeof patch === 'object' ? patch : {})
    return aiSettingsView()
  })
  // Choosing a preset brings back what it was set to; a typed preset keeps saved addresses (7.2).
  handleTrusted('ai:choose-provider', async (_event, id: unknown) => {
    await chooseAiProvider(typeof id === 'string' && providerPreset(id) ? id as ProviderId : null)
    return aiSettingsView()
  })
  handleTrusted('ai:save-address', async (_event, input: { address?: unknown; replacing?: unknown }) => {
    await saveTypedAddress(typeof input?.address === 'string' ? input.address : '', input?.replacing === true)
    return aiSettingsView()
  })
  handleTrusted('ai:use-saved-address', async (_event, address: unknown) => {
    if (typeof address === 'string') await useSavedAddress(address)
    return aiSettingsView()
  })
  handleTrusted('ai:remove-saved-address', async (_event, address: unknown) => {
    if (typeof address === 'string') await removeSavedAddress(address)
    return aiSettingsView()
  })
  // The key goes one way: a window can save or remove it, never read it back.
  handleTrusted('ai:set-key', (_event, key: unknown) => {
    setProviderKey(typeof key === 'string' ? key : null)
    return aiSettingsView()
  })
  handleTrusted('ai:list-models', () => aiListModels())
  handleTrusted('ai:test-connection', (_event, model: unknown) => aiTestConnection(typeof model === 'string' ? model : ''))
  // A brain dump (4.8) is a dictation request with its own prompts and schema (`brainDump`).
  handleTrusted('ai:dictate', async (_event, input: { requestId?: unknown; edit?: unknown; user?: unknown; brainDump?: unknown }) => {
    const id = typeof input?.requestId === 'string' ? input.requestId : ''
    const controller = new AbortController()
    if (id) dictations.set(id, controller)
    try {
      const request = { edit: input?.edit === true, user: typeof input?.user === 'string' ? input.user : '' }
      return await (input?.brainDump === true ? aiBrainDump(request, controller.signal) : aiDictate(request, controller.signal))
    } finally {
      if (id) dictations.delete(id)
    }
  })
  handleTrusted('ai:cancel-dictation', (_event, id: unknown) => {
    const controller = typeof id === 'string' ? dictations.get(id) : undefined
    controller?.abort()
    return !!controller
  })
  // A guided session's suggestions (section 9): Ask's model, cancelled like a dictation.
  handleTrusted('ai:organize', async (_event, input: { requestId?: unknown; user?: unknown }) => {
    const id = typeof input?.requestId === 'string' ? input.requestId : ''
    const controller = new AbortController()
    if (id) dictations.set(id, controller)
    try {
      return await aiOrganize({ user: typeof input?.user === 'string' ? input.user : '' }, controller.signal)
    } finally {
      if (id) dictations.delete(id)
    }
  })
  handleTrusted('ai:ask-start', (event, request: AskTurnRequest) => {
    const sender = event.sender
    if (!request || typeof request.turnId !== 'string' || !Array.isArray(request.messages)) return false
    void aiAskTurn(request, (turnEvent) => {
      if (!sender.isDestroyed()) sender.send('ai:ask-event', { turnId: request.turnId, event: turnEvent })
    })
    return true
  })
  handleTrusted('ai:ask-cancel', (_event, turnId: unknown) => typeof turnId === 'string' && cancelAskTurn(turnId))

  handleTrusted('ai:get-conversations', () => getConversations())
  handleTrusted('ai:save-conversations', (_event, list: unknown) => saveConversations(list))
  handleTrusted('ai:get-kept-transcripts', () => getKeptTranscripts())
  handleTrusted('ai:keep-transcript', async (_event, entry: KeptTranscript) => {
    if (entry && typeof entry.id === 'string' && typeof entry.transcript === 'string') await keepTranscript(entry)
    return true
  })
  handleTrusted('ai:drop-kept-transcript', async (_event, id: unknown) => {
    if (typeof id === 'string') await dropKeptTranscript(id)
    return true
  })

  handleTrusted('speech:status', () => speechStatus())
  handleTrusted('speech:download', (_event, id: unknown) => startModelDownload(typeof id === 'string' ? id : ''))
  handleTrusted('speech:cancel-download', (_event, id: unknown) => cancelModelDownload(typeof id === 'string' ? id : ''))
  handleTrusted('speech:delete-model', (_event, id: unknown) => deleteSpeechModel(typeof id === 'string' ? id : ''))
  handleTrusted('speech:start', (event, options: unknown) => startSpeechSession(event.sender, (options ?? {}) as Record<string, unknown>))
  handleTrusted('speech:audio', (event, id: unknown, samples: unknown) => feedSpeechAudio(event.sender, id, samples))
  handleTrusted('speech:stop', (event, id: unknown) => stopSpeechSession(event.sender, id))
  handleTrusted('speech:cancel', (event, id: unknown) => cancelSpeechSession(event.sender, id))
}

/** Sign-out and account switch (7.2): conversations and kept transcripts go; device settings stay. */
export async function forgetAiAccountData(): Promise<void> {
  cancelAllAskTurns()
  await clearAiAccountData()
}

/** At quit: writes finished, native speech handles closed. */
export async function shutdownAi(): Promise<void> {
  cancelAllAskTurns()
  for (const controller of dictations.values()) controller.abort()
  await Promise.all([flushAiSettings(), flushAiLocalData(), shutdownSpeech()])
}
