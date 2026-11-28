import { t } from '../../shared/i18n'
import type { VoiceErrorCode, VoiceEvent } from '../../shared/voice-types'

// The line protocol of the speech helpers (native/voice-macos/VicuSpeech.swift,
// resources/voice/voice-windows.ps1): one JSON object per stdout line. Pure, so it is tested
// without a helper.

export interface HelperCheck {
  available: boolean
  onDevice: boolean
  authorization: string
  locale: string
}

export type HelperMessage =
  | { kind: 'event'; event: VoiceEvent }
  | { kind: 'check'; check: HelperCheck }

const ERROR_CODES = new Set<VoiceErrorCode>([
  'unsupported', 'unavailable', 'no-recognizer', 'mic-denied', 'speech-denied', 'audio', 'busy', 'failed',
])

function errorCode(value: unknown): VoiceErrorCode {
  return typeof value === 'string' && ERROR_CODES.has(value as VoiceErrorCode) ? (value as VoiceErrorCode) : 'failed'
}

/** One stdout line as a message, or null for anything that is not one (a stray log line). */
export function parseHelperLine(line: string): HelperMessage | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return null
  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const message = raw as Record<string, unknown>
  const text = typeof message.text === 'string' ? message.text : ''
  switch (message.type) {
    case 'ready':
      return { kind: 'event', event: { type: 'ready' } }
    case 'partial':
      return { kind: 'event', event: { type: 'partial', text } }
    case 'final':
      return { kind: 'event', event: { type: 'final', text } }
    case 'error':
      return {
        kind: 'event',
        event: {
          type: 'error',
          code: errorCode(message.code),
          message: typeof message.message === 'string' && message.message ? message.message : t('system.voice.stopped'),
        },
      }
    case 'check':
      return {
        kind: 'check',
        check: {
          available: message.available === true,
          onDevice: message.onDevice === true,
          authorization: typeof message.authorization === 'string' ? message.authorization : 'unknown',
          locale: typeof message.locale === 'string' ? message.locale : '',
        },
      }
    default:
      return null
  }
}

/**
 * Splits a byte stream into lines across chunk boundaries (a chunk may end mid-line or mid
 * character). `push` returns the complete lines; `flush` the rest at the end of the stream.
 */
export function createLineSplitter(): { push: (chunk: Buffer | string) => string[]; flush: () => string[] } {
  const decoder = new TextDecoder('utf-8')
  let pending = ''
  const split = (): string[] => {
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''
    return lines.filter((line) => line.length > 0)
  }
  return {
    push: (chunk) => {
      pending += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
      return split()
    },
    flush: () => {
      pending += decoder.decode()
      const rest = pending.trim() ? [pending] : []
      pending = ''
      return rest
    },
  }
}
