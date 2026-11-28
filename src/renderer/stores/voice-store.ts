import { create } from 'zustand'
import type { RecognizerHandlers, VoiceRecognizer } from '@/lib/voice/recognizer'
import { appRecognizer } from '@/lib/ai/recognizers'
import { cancelOpenMic, type AdoptedSession } from '@/lib/ai/open-mic'
import { toast } from '@/stores/toast-store'
import { announce } from '@/stores/announcer-store'
import { t } from '../../shared/i18n'
import type { VoiceErrorCode } from '../../shared/voice-types'
import { joinWords } from '../../shared/ai/turns'
import type { VoiceListDefaults } from '@/lib/voice/voice-task'
import { useVoiceListStore } from '@/stores/voice-list-store'

// One voice capture at a time (docs/voice-input.md): who started it, what has been heard, and
// whether letting go adds or cancels. The + button, the voice shortcut and the command palette
// start it; VoiceHost draws the card and adds the task when the final text arrives. This is quick
// capture: the words become one task through quick add, never through the model. Locking it
// (sliding up from a held +, tapping the voice shortcut) hands the running recogniser to smart
// dictation instead, when that is ready (docs/ai-assistant-v1.md section 4).

/** What started the capture: holding +, the voice shortcut, or "Say a task" (palette). */
export type VoiceSource = 'button' | 'shortcut' | 'command'
/** `hold`: letting go adds. `latched`: listening until Enter, the shortcut again, or Add. */
export type VoiceMode = 'hold' | 'latched'
export type VoicePhase = 'idle' | 'starting' | 'listening' | 'finishing' | 'adding'

interface VoiceState {
  phase: VoicePhase
  source: VoiceSource
  mode: VoiceMode
  /** The words so far. */
  text: string
  /** The composer defaults of the list on screen when the capture started (null: the Inbox). */
  list: VoiceListDefaults | null
  /** The pointer moved away while holding +: letting go now cancels. */
  cancelArmed: boolean
  /** The final text, waiting for VoiceHost to add it (phase `adding`). */
  finalText: string | null
  /** Bumped when there is no engine here: VoiceHost opens the composer instead. */
  fallbackRequest: number
  /** Smart dictation is ready: a capture can be locked into it. */
  lockable: boolean
  begin: (source: VoiceSource, mode: VoiceMode) => void
  setMode: (mode: VoiceMode) => void
  /** The voice shortcut was tapped: smart dictation when it is ready, else quick capture until Enter. */
  latch: () => void
  /** Hands the running capture to smart dictation; false when it is not ready or nothing runs. */
  lock: () => boolean
  armCancel: (armed: boolean) => void
  /** Stop listening and add what was heard. */
  finish: () => void
  /** Throw the words away. */
  cancel: () => void
  /** VoiceHost added (or gave up on) the final text. */
  done: () => void
}

/** Takes a locked capture: VoiceHost starts smart dictation with the list's defaults. */
export type VoiceLockHandler = (session: AdoptedSession, list: VoiceListDefaults | null) => void

let lockHandler: VoiceLockHandler | null = null

/** Set by VoiceHost while smart dictation is ready; null otherwise (a capture cannot be locked). */
export function setVoiceLock(handler: VoiceLockHandler | null): void {
  lockHandler = handler
  if (useVoiceStore.getState().lockable !== (handler !== null)) useVoiceStore.setState({ lockable: handler !== null })
}

/**
 * The running capture: where its recogniser events go (the card, or smart dictation once locked)
 * and what local speech said about its turns, so a lock hands over what was heard.
 */
interface Capture {
  target: RecognizerHandlers
  /** null until the recogniser is ready. */
  turns: boolean | null
  /** Local speech: the words of the turns that ended, and of the one being heard. */
  ended: string
  turn: string
  speaking: boolean
}

let capture: Capture | null = null

let recognizer: VoiceRecognizer | null = null
function getRecognizer(): VoiceRecognizer {
  // Local speech when a speech model is downloaded, else the platform recogniser (lib/ai/recognizers.ts).
  recognizer ??= appRecognizer()
  return recognizer
}

/** Test hook: use a fake recognizer. */
export function setVoiceRecognizer(next: VoiceRecognizer | null): void {
  recognizer = next
}

const IDLE = { phase: 'idle' as const, text: '', cancelArmed: false, finalText: null }

function errorToast(code: VoiceErrorCode, message: string): void {
  if (code === 'unsupported') {
    toast.info(t('voice.messages.unavailable'))
    return
  }
  toast.error(message || t('voice.messages.stopped'))
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  ...IDLE,
  source: 'button',
  mode: 'hold',
  list: null,
  fallbackRequest: 0,
  lockable: false,

  begin: (source, mode) => {
    if (get().phase !== 'idle') return
    // One microphone: an open one (smart dictation, Talk) gives way.
    cancelOpenMic()
    // The list is read once: navigating while talking does not move the task.
    set({ ...IDLE, phase: 'starting', source, mode, list: useVoiceListStore.getState().defaults })
    announce(t('voice.messages.listeningAnnounce'))
    const own: RecognizerHandlers = {
      onReady: () => {
        if (get().phase === 'starting') set({ phase: 'listening' })
      },
      onPartial: (text) => {
        const phase = get().phase
        if (phase === 'starting' || phase === 'listening' || phase === 'finishing') set({ text, phase: phase === 'starting' ? 'listening' : phase })
      },
      onFinal: (text) => {
        if (get().phase === 'idle') return
        const heard = text.trim() || get().text.trim()
        if (!heard) {
          set(IDLE)
          toast.info(t('voice.messages.nothingHeardToast'))
          return
        }
        set({ phase: 'adding', text: heard, finalText: heard, cancelArmed: false })
      },
      onError: (code, message) => {
        if (get().phase === 'idle') return
        set(IDLE)
        errorToast(code, message)
        if (code === 'unsupported') set((state) => ({ fallbackRequest: state.fallbackRequest + 1 }))
      },
    }
    const current: Capture = { target: own, turns: null, ended: '', turn: '', speaking: false }
    capture = current
    // Every event goes through the capture, so a lock can send the rest to smart dictation.
    const owned = () => current.target === own
    void getRecognizer().start({
      onReady: (info) => {
        if (owned()) current.turns = info?.turns === true
        current.target.onReady(info)
      },
      onPartial: (text, turn) => {
        if (owned()) current.turn = turn ?? ''
        current.target.onPartial(text, turn)
      },
      onSpeech: () => {
        if (owned()) current.speaking = true
        current.target.onSpeech?.()
      },
      onTurn: (text) => {
        if (owned()) {
          current.ended = joinWords(current.ended, text)
          current.turn = ''
          current.speaking = false
        }
        current.target.onTurn?.(text)
      },
      onFinal: (text, turn) => current.target.onFinal(text, turn),
      onError: (code, message) => current.target.onError(code, message),
    })
  },

  setMode: (mode) => {
    if (get().phase !== 'idle') set({ mode })
  },

  latch: () => {
    if (!get().lock()) get().setMode('latched')
  },

  lock: () => {
    const { phase, list, text } = get()
    const current = capture
    const handler = lockHandler
    if (!current || !handler || (phase !== 'starting' && phase !== 'listening')) return false
    capture = null
    // Without the recogniser's word (not ready yet) nothing has been heard: it says so when ready.
    const local = current.turns === true
    const session: AdoptedSession = {
      attach: (handlers) => { current.target = handlers },
      ready: current.turns !== null,
      vad: local,
      carried: local ? current.ended : '',
      heard: local ? current.turn : text,
      speaking: current.speaking,
    }
    // Not cancelled: the recogniser goes on for smart dictation.
    set(IDLE)
    handler(session, list)
    return true
  },

  armCancel: (armed) => {
    if (get().phase !== 'idle' && get().cancelArmed !== armed) set({ cancelArmed: armed })
  },

  finish: () => {
    const { phase } = get()
    if (phase !== 'starting' && phase !== 'listening') return
    set({ phase: 'finishing', cancelArmed: false })
    getRecognizer().stop()
  },

  cancel: () => {
    const { phase } = get()
    if (phase === 'idle' || phase === 'adding') return
    capture = null
    getRecognizer().cancel()
    set(IDLE)
    announce(t('voice.messages.cancelled'))
  },

  done: () => {
    capture = null
    set(IDLE)
  },
}))

/** True while a capture is on screen. */
export function isVoiceActive(): boolean {
  return useVoiceStore.getState().phase !== 'idle'
}
