import { create } from 'zustand'
import { OpenMic, openMicSettings, type OpenMicEffect, type OpenMicStart } from '../../../shared/ai/turns'
import type { VoiceErrorCode } from '../../../shared/voice-types'
import type { RecognizerHandlers, VoiceRecognizer } from '../voice/recognizer'
import { toast } from '@/stores/toast-store'
import { t } from '../../../shared/i18n'
import { appRecognizer } from './recognizers'

/**
 * The open microphone (docs/ai-assistant-v1.md section 3.7) for smart dictation once locked and for
 * Talk: the app's recogniser kept on, its words cut into turns, each turn handed to the owner, the
 * request of a turn cancelled when the person talks again, a pause while the device reads an answer.
 * The rules are the pure `OpenMic` (src/shared/ai/turns.ts); this runs its effects with one timer
 * and the recogniser. One microphone at a time: starting it again for another owner stops the first.
 */

export type OpenMicOwner = 'dictation' | 'ask'
/** `starting`: the recogniser is not ready yet. */
export type OpenMicStatus = 'off' | 'starting' | 'listening' | 'paused' | 'stopping'

interface OpenMicView {
  owner: OpenMicOwner | null
  status: OpenMicStatus
  /** Carried words and the turn being heard. */
  words: string
}

export const useOpenMicStore = create<OpenMicView>(() => ({ owner: null, status: 'off', words: '' }))

export interface OpenMicClient {
  /** A turn's words. Resolves when the request for them has finished (at once when they answered a card). */
  onTurn: (text: string) => Promise<void>
  /** The person talks again: cancel the request still running for the previous turn. */
  onInterrupt: () => void
  /** The microphone went off (idle, turned off, or failed). */
  onOff?: () => void
}

/** A recogniser session already running (a quick capture locked into smart dictation). */
export interface AdoptedSession extends OpenMicStart {
  /** Sends the session's events to these handlers from now on. */
  attach: (handlers: RecognizerHandlers) => void
  /** Whether the session has said if it reports its own turns; until then its `onReady` will. */
  ready: boolean
}

const TICK_MS = 200

let machine: OpenMic | null = null
let client: OpenMicClient | null = null
let timer: ReturnType<typeof setInterval> | null = null
/** The recogniser session events are taken from; older ones are ignored. */
let session = 0
let recognizer: () => VoiceRecognizer = appRecognizer

/** Test hook. */
export function setOpenMicRecognizer(next: VoiceRecognizer | null): void {
  recognizer = next ? () => next : appRecognizer
}

const now = () => performance.now()

function publish(status?: OpenMicStatus): void {
  if (!machine) return
  const view = useOpenMicStore.getState()
  const phase = machine.phase
  const next = { status: status ?? (phase === 'listening' && view.status === 'starting' ? 'starting' : phase), words: machine.words }
  if (next.status !== view.status || next.words !== view.words) useOpenMicStore.setState(next)
}

function run(effects: OpenMicEffect[]): void {
  for (const effect of effects) {
    switch (effect.type) {
      case 'send': {
        const owner = client
        const id = effect.id
        void owner?.onTurn(effect.text).catch(() => {}).finally(() => {
          if (machine && client === owner) machine.done(now(), id)
        })
        break
      }
      case 'cancel':
        client?.onInterrupt()
        break
      case 'pause':
        session++
        recognizer().cancel()
        break
      case 'listen':
        listen()
        break
      case 'finish':
        recognizer().stop()
        break
      case 'off':
        turnOff()
        return
    }
  }
  publish()
}

function errorToast(code: VoiceErrorCode, message: string): void {
  if (code === 'unsupported') toast.info(t('voice.messages.unavailable'))
  else toast.error(message || t('voice.messages.stopped'))
}

function handlersFor(id: number, turns = false): RecognizerHandlers {
  let vad = turns
  const live = () => id === session && machine !== null
  return {
    onReady: (info) => {
      if (!live()) return
      vad = info?.turns === true
      machine!.session(vad)
      publish(machine!.phase === 'listening' ? 'listening' : undefined)
    },
    onPartial: (text, turn) => {
      if (live()) run(machine!.heard(now(), vad ? turn ?? '' : text))
    },
    onSpeech: () => {
      if (live()) run(machine!.speech(now()))
    },
    onTurn: (text) => {
      if (live()) run(machine!.turn(now(), text))
    },
    onFinal: (text, turn) => {
      if (live()) run(machine!.final(now(), vad ? turn ?? text : text))
    },
    onError: (code, message) => {
      if (!live()) return
      errorToast(code, message)
      run(machine!.cancel())
    },
  }
}

function listen(): void {
  const id = ++session
  publish('starting')
  void recognizer().start(handlersFor(id), { openMic: true })
}

/** `keepRecognizer`: a session being handed over to a new microphone must keep running. */
function turnOff(keepRecognizer = false): void {
  session++
  if (!keepRecognizer) recognizer().cancel()
  if (timer !== null) clearInterval(timer)
  timer = null
  const owner = client
  machine = null
  client = null
  useOpenMicStore.setState({ owner: null, status: 'off', words: '' })
  owner?.onOff?.()
}

/**
 * Turns the microphone on for `owner`, or takes over a running recogniser session. `dump`: a brain
 * dump (4.8), which listens for `speech.turn.dump_idle_s` without speech before it turns off.
 */
export function startOpenMic(owner: OpenMicOwner, next: OpenMicClient, adopt?: AdoptedSession, options: { dump?: boolean } = {}): void {
  if (machine) {
    machine.cancel()
    turnOff(adopt !== undefined)
  }
  machine = new OpenMic(openMicSettings(options.dump === true))
  client = next
  useOpenMicStore.setState({ owner, status: 'starting', words: '' })
  timer = setInterval(() => {
    if (machine) run(machine.tick(now()))
  }, TICK_MS)
  if (adopt) {
    const id = ++session
    adopt.attach(handlersFor(id, adopt.vad === true))
    run(machine.start(now(), adopt))
    if (adopt.ready) publish('listening')
    return
  }
  run(machine.start(now()))
  listen()
}

/** Turns it off; the words of the turn being heard still go out. */
export function stopOpenMic(): void {
  if (machine) run(machine.stop(now()))
}

/** Turns it off at once; the words being heard are dropped. */
export function cancelOpenMic(): void {
  if (machine) run(machine.cancel())
}

/** The device reads an answer aloud (true) or has finished (false). */
export function openMicVoice(speaking: boolean): void {
  if (machine) run(machine.voice(now(), speaking))
}

/** The brain dump switch changed while the microphone is on: the idle time that turns it off follows. */
export function setOpenMicDump(dump: boolean): void {
  machine?.setIdleMs(openMicSettings(dump).idleMs)
}

/** False while the running request must not be cancelled by talking (a card waits, a change was applied). */
export function setOpenMicInterruptible(value: boolean): void {
  machine?.setInterruptible(value)
}

/** The person is in the middle of a turn. */
export function openMicHearing(): boolean {
  return machine?.hearing ?? false
}

export function openMicOwner(): OpenMicOwner | null {
  return machine ? useOpenMicStore.getState().owner : null
}
