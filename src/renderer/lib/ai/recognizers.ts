import { createRecognizer, type RecognizerHandlers, type RecognizerStartOptions, type VoiceRecognizer } from '../voice/recognizer'
import type { SpeechStartOptions } from '../../../shared/ai/types'
import { createLocalRecognizer } from './local-recognizer'
import { can } from '../capabilities'

/**
 * Which recogniser a capture uses (docs/ai-assistant-v1.md sections 3 and 3.6): local speech when
 * a speech model is downloaded and the engine is part of this build, otherwise the platform
 * recogniser as before (Apple's on macOS, the Windows desktop recogniser, none on Linux). Decided
 * when each capture starts, so a model downloaded in Settings is used at once.
 */
export function createAutoRecognizer(platform: VoiceRecognizer, local: VoiceRecognizer, useLocal: () => Promise<boolean>): VoiceRecognizer {
  let active: VoiceRecognizer | null = null
  return {
    availability: async (force) => ((await useLocal().catch(() => false)) ? local.availability(force) : platform.availability(force)),
    start: async (handlers: RecognizerHandlers, options?: RecognizerStartOptions) => {
      const chosen = (await useLocal().catch(() => false)) ? local : platform
      if (active && active !== chosen) active.cancel()
      active = chosen
      return chosen.start(handlers, options)
    },
    stop: () => active?.stop(),
    cancel: () => active?.cancel(),
  }
}

let startOptions: () => SpeechStartOptions = () => ({})

/** The language setting and vocabulary hint of local speech; kept current by AiHost. */
export function setSpeechStartOptions(provider: () => SpeechStartOptions): void {
  startOptions = provider
}

const NO_RECOGNIZER: VoiceRecognizer = {
  availability: async () => ({ available: false, engine: 'none', onDevice: false }),
  start: async () => false,
  stop: () => {},
  cancel: () => {},
}

let shared: VoiceRecognizer | null = null

/** The app's recogniser: one for the main window, shared by voice input, dictation and Talk. */
export function appRecognizer(): VoiceRecognizer {
  // A host with neither voice input nor the assistant (the web version) listens to nothing and
  // never reaches for window.api.voice or window.api.speech.
  if (!can('voice') && !can('assistant')) return NO_RECOGNIZER
  if (!shared) {
    const platform = createRecognizer(window.api.voice, () => navigator.language)
    const local = createLocalRecognizer(window.api.speech, { startOptions: () => startOptions() })
    shared = createAutoRecognizer(platform, local, async () => {
      const status = await window.api.speech.status()
      return status.engine && status.activeModelId !== null
    })
  }
  return shared
}
