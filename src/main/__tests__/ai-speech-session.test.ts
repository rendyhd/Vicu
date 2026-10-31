import { describe, expect, it, vi } from 'vitest'
import { SpeechEngine, SpeechSession } from '../ai/speech/engine'
import type { NativeHandle, SpeechNative } from '../ai/speech/native'
import type { SpeechEvent } from '../../shared/ai/types'

// docs/ai-assistant-v1.md sections 3.1 to 3.3: phrases are transcribed in order while the user
// talks, the final text joins them, and every handle closes.

function fakeNative(transcribeMs: number[]) {
  const log: string[] = []
  let call = 0
  const native: SpeechNative = {
    version: () => '1.9.5',
    vadWindowSamples: () => 512,
    vadOpen: () => { log.push('vad-open'); return { vad: true } as NativeHandle },
    // Speech wherever the samples are loud.
    vadFeed: (_vad, samples) => {
      const probs: number[] = []
      for (let i = 0; i + 512 <= samples.length; i += 512) probs.push(Math.abs(samples[i]) > 0.1 ? 0.9 : 0.01)
      return probs
    },
    vadReset: () => { log.push('vad-reset') },
    vadClose: () => { log.push('vad-close') },
    modelOpen: async (path) => { log.push(`model-open ${path}`); return { model: true } as NativeHandle },
    transcribe: async (_m, samples, language, prompt) => {
      const n = call++
      await new Promise((resolve) => setTimeout(resolve, transcribeMs[n] ?? 1))
      log.push(`transcribe ${n} ${language} ${prompt}`)
      return n === 1 ? ' ... ' : ` phrase ${n} (${Math.round(samples.length / 1600) / 10}s) `
    },
    abort: () => { log.push('abort') },
    modelClose: () => { log.push('model-close') },
  }
  return { native, log }
}

function audio(seconds: number, loud: boolean): Float32Array {
  return new Float32Array(Math.round(seconds * 16000)).fill(loud ? 0.5 : 0)
}

// Waits for the session instead of a fixed time: each fake transcription waits on a timer, which
// Windows runs on a ~15 ms tick, so 23 phrases took 300 to 330 ms and a fixed 300 ms wait failed
// about one run in three (more under load).
const SESSION_WAIT = { timeout: 8000, interval: 5 }

describe('speech session', () => {
  it('transcribes finished phrases in order, even when a later one is faster, and joins them', async () => {
    const { native, log } = fakeNative([60, 1, 1])
    const engine = new SpeechEngine(native, '/vad.bin')
    const events: SpeechEvent[] = []
    const session = new SpeechSession(engine, { modelPath: '/m.bin', engine: 0, language: 'auto', hint: 'Inbox.' }, (e) => events.push(e))
    session.start()
    for (const part of [audio(0.5, false), audio(1, true), audio(1, false), audio(0.6, true), audio(1, false), audio(0.8, true)]) {
      for (let i = 0; i < part.length; i += 1600) session.addAudio(part.subarray(i, i + 1600))
    }
    await session.stop()
    expect(events[0]).toEqual({ type: 'ready' })
    // Pauses of 1 s are just short of a turn's end (31 windows of 32 ms): one turn.
    expect(events.at(-1)).toEqual({ type: 'final', text: 'phrase 0 (1.4s) phrase 2 (1s)', turn: 'phrase 0 (1.4s) phrase 2 (1s)' })
    expect(log.filter((l) => l.startsWith('transcribe'))).toEqual(['transcribe 0 null Inbox.', 'transcribe 1 null Inbox.', 'transcribe 2 null Inbox.'])
    await engine.closeAll()
    expect(log.slice(-2)).toEqual(['model-close', 'vad-close'])
  })

  it('passes a fixed language and ends a cancelled session without a final text', async () => {
    const { native } = fakeNative([1])
    const engine = new SpeechEngine(native, '/vad.bin')
    const events: SpeechEvent[] = []
    const session = new SpeechSession(engine, { modelPath: '/m.bin', engine: 0, language: 'nl', hint: null }, (e) => events.push(e))
    session.start()
    session.addAudio(audio(1, true))
    session.cancel()
    await session.stop()
    expect(events.map((e) => e.type)).toEqual(['ready'])
    await engine.closeAll()
  })

  it('reports turns (3.7): speech, then the turn with its words once its phrases are transcribed', async () => {
    const { native } = fakeNative([60, 1, 1])
    const engine = new SpeechEngine(native, '/vad.bin')
    const events: SpeechEvent[] = []
    const session = new SpeechSession(engine, { modelPath: '/m.bin', engine: 0, language: 'auto', hint: null }, (e) => events.push(e))
    session.start()
    // One turn of two phrases (a 0.7 s pause between them), a pause that ends it, then a third phrase.
    for (const part of [audio(1, true), audio(0.7, false), audio(1, true), audio(1.2, false), audio(0.6, true)]) {
      for (let i = 0; i < part.length; i += 1600) session.addAudio(part.subarray(i, i + 1600))
    }
    await session.stop()
    const summary = events.map((e) => (e.type === 'turn' ? `turn:${e.text}` : e.type === 'partial' ? `partial:${e.turn}` : e.type === 'final' ? `final:${e.turn}` : e.type))
    expect(summary).toEqual([
      'ready',
      'speech',
      'partial:phrase 0 (1.2s)',
      'partial:phrase 0 (1.2s)',
      'turn:phrase 0 (1.2s)',
      'speech',
      'partial:phrase 2 (0.8s)',
      'final:phrase 2 (0.8s)',
    ])
    await engine.closeAll()
  })

  it('with an open microphone, 600 s count per turn: the turn ends and the recording goes on', async () => {
    const { native } = fakeNative([])
    const engine = new SpeechEngine(native, '/vad.bin')
    const events: SpeechEvent[] = []
    const session = new SpeechSession(engine, { modelPath: '/m.bin', engine: 0, language: 'auto', hint: null, openMic: true }, (e) => events.push(e))
    session.start()
    const minute = audio(60, true)
    for (let i = 0; i < 11; i++) session.addAudio(minute)
    await vi.waitFor(() => expect(events.some((e) => e.type === 'turn')).toBe(true), SESSION_WAIT)
    expect(events.some((e) => e.type === 'final')).toBe(false)
    session.cancel()
    await engine.closeAll()
  }, 10000)

  it('stops by itself after 600 s', async () => {
    const { native } = fakeNative([])
    const engine = new SpeechEngine(native, '/vad.bin')
    const events: SpeechEvent[] = []
    const session = new SpeechSession(engine, { modelPath: '/m.bin', engine: 0, language: 'auto', hint: null }, (e) => events.push(e))
    session.start()
    const minute = audio(60, false)
    for (let i = 0; i < 11; i++) session.addAudio(minute)
    await vi.waitFor(() => expect(events.at(-1)?.type).toBe('final'), SESSION_WAIT)
    await engine.closeAll()
  }, 10000)
})
