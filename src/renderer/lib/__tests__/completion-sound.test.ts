import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { readCompletionSound } = vi.hoisted(() => ({ readCompletionSound: vi.fn() }))
vi.mock('../api', () => ({ api: { readCompletionSound } }))

class FakeAudio {
  static last: FakeAudio | null = null
  static plays = 0
  static fails = false
  currentTime = 7
  preload = ''
  constructor(public src: string) {
    FakeAudio.last = this
  }
  play(): Promise<void> {
    FakeAudio.plays++
    return FakeAudio.fails ? Promise.reject(new Error('decode')) : Promise.resolve()
  }
  pause(): void {}
}

const READABLE = { success: true, data: new Uint8Array([1, 2, 3]), mimeType: 'audio/mpeg' }

// The module keeps the loaded sound in module state, so each test imports a fresh copy.
async function freshModule() {
  vi.resetModules()
  return import('../completion-sound')
}

beforeEach(() => {
  FakeAudio.last = null
  FakeAudio.plays = 0
  FakeAudio.fails = false
  vi.stubGlobal('Audio', FakeAudio)
  readCompletionSound.mockResolvedValue(READABLE)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('previewCompletionSound (issue 71: Play in Settings)', () => {
  it('plays from the start, with the sound switched off and right after a completion played it', async () => {
    const sound = await freshModule()
    await sound.reloadCompletionSound()
    sound.playCompletionSound()
    FakeAudio.last!.currentTime = 7
    sound.setCompletionSoundEnabled(false)
    expect(await sound.previewCompletionSound()).toBe(true)
    expect(FakeAudio.plays).toBe(2)
    expect(FakeAudio.last!.currentTime).toBe(0)
  })

  it('waits for a reload that is still running', async () => {
    const sound = await freshModule()
    const reload = sound.reloadCompletionSound()
    expect(await sound.previewCompletionSound()).toBe(true)
    await reload
  })

  it('answers false when the file cannot be read', async () => {
    readCompletionSound.mockResolvedValue({ success: false, error: 'missing' })
    const sound = await freshModule()
    await sound.reloadCompletionSound()
    expect(await sound.previewCompletionSound()).toBe(false)
  })

  it('answers false when the file cannot be played', async () => {
    const sound = await freshModule()
    await sound.reloadCompletionSound()
    FakeAudio.fails = true
    expect(await sound.previewCompletionSound()).toBe(false)
  })
})
