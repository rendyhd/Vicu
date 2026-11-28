import { t } from '../../shared/i18n'
import type { VoiceEvent } from '../../shared/voice-types'
import { createLineSplitter, parseHelperLine } from './helper-protocol'

// One listening session over a speech helper process: reads its event lines, sends it "stop" and
// "cancel", and guarantees the caller exactly one ending (a final or an error), whatever the
// helper does. No Electron and no real process here: `HelperProcess` is the part of a
// ChildProcess it uses, so the tests drive it with a fake.

export interface HelperProcess {
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null
  stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null
  stdin: { write(data: string): unknown; end(): unknown; on?(event: 'error', listener: (err: Error) => void): unknown } | null
  on(event: 'exit', listener: (code: number | null) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  kill(): unknown
}

export interface VoiceSessionHandle {
  /** Finish listening; the final text follows. */
  stop(): void
  /** Throw the utterance away; nothing more is reported. */
  cancel(): void
}

/** How long a helper may take to answer "stop" before what was heard so far is the final text. */
export const HELPER_STOP_TIMEOUT_MS = 4000
/** How long a helper may take to exit after "cancel" before it is killed. */
export const HELPER_CANCEL_GRACE_MS = 500

export interface HelperSessionOptions {
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export function runHelperSession(
  child: HelperProcess,
  onEvent: (event: VoiceEvent) => void,
  options: HelperSessionOptions = {},
): VoiceSessionHandle {
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const lines = createLineSplitter()
  let lastText = ''
  let stderr = ''
  let ended = false
  let stopping = false
  let cancelled = false
  let exited = false
  let stopTimer: unknown = null

  const end = (event: Extract<VoiceEvent, { type: 'final' | 'error' }>) => {
    if (ended) return
    ended = true
    if (stopTimer !== null) clearTimer(stopTimer)
    if (!cancelled) onEvent(event)
  }

  const handleLine = (line: string) => {
    const message = parseHelperLine(line)
    if (!message || message.kind !== 'event' || ended) return
    const event = message.event
    if (event.type === 'partial') {
      lastText = event.text
      if (!cancelled) onEvent(event)
    } else if (event.type === 'ready') {
      if (!cancelled) onEvent(event)
    } else {
      end(event)
    }
  }

  child.stdout?.on('data', (chunk) => { for (const line of lines.push(chunk)) handleLine(line) })
  child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-500) })
  // Writing to a helper that already exited is not an error worth surfacing.
  child.stdin?.on?.('error', () => {})
  child.on('error', (err) => end({ type: 'error', code: 'failed', message: t('system.voice.couldNotStart', { reason: err.message }) }))
  child.on('exit', () => {
    exited = true
    for (const line of lines.flush()) handleLine(line)
    if (stopping) end({ type: 'final', text: lastText })
    else end({ type: 'error', code: 'failed', message: stderr.trim() ? t('system.voice.stoppedBecause', { reason: stderr.trim().split('\n').pop() }) : t('system.voice.stopped') })
  })

  const send = (command: string) => {
    try { child.stdin?.write(`${command}\n`) } catch { /* the helper is gone; exit handles it */ }
  }

  return {
    stop: () => {
      if (ended || stopping) return
      stopping = true
      send('stop')
      stopTimer = setTimer(() => {
        end({ type: 'final', text: lastText })
        if (!exited) child.kill()
      }, HELPER_STOP_TIMEOUT_MS)
    },
    cancel: () => {
      if (cancelled) return
      cancelled = true
      send('cancel')
      try { child.stdin?.end() } catch { /* already closed */ }
      setTimer(() => { if (!exited) child.kill() }, HELPER_CANCEL_GRACE_MS)
      ended = true
      if (stopTimer !== null) clearTimer(stopTimer)
    },
  }
}
