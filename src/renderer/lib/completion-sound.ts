import { api } from '@/lib/api'

let audio: HTMLAudioElement | null = null
let objectUrl: string | null = null
let loadingPromise: Promise<void> | null = null
let enabled = true
// Throttle so a bulk-complete (which fires playCompletionSound once per task)
// produces a single sound instead of a rapid stutter.
let lastPlayedAt = 0

function disposeAudio(): void {
  if (audio) {
    audio.pause()
    audio.src = ''
    audio = null
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }
}

export async function reloadCompletionSound(): Promise<void> {
  if (loadingPromise) return loadingPromise
  loadingPromise = (async () => {
    try {
      disposeAudio()
      const result = await api.readCompletionSound()
      if (!result.success) return
      const blob = new Blob([result.data], { type: result.mimeType })
      objectUrl = URL.createObjectURL(blob)
      audio = new Audio(objectUrl)
      audio.preload = 'auto'
    } finally {
      loadingPromise = null
    }
  })()
  return loadingPromise
}

export function setCompletionSoundEnabled(value: boolean): void {
  enabled = value
}

export function playCompletionSound(): void {
  if (!enabled || !audio) return
  const now = Date.now()
  if (now - lastPlayedAt < 250) return
  lastPlayedAt = now
  try {
    audio.currentTime = 0
    void audio.play().catch(() => { /* ignore autoplay/decode errors */ })
  } catch { /* ignore */ }
}

/**
 * Settings' Play button: plays the current sound from the start, waiting for a reload still
 * running. Unlike a completion it ignores the switch and the throttle, and it answers false when
 * the sound cannot be played, so Settings can say so.
 */
export async function previewCompletionSound(): Promise<boolean> {
  if (loadingPromise) await loadingPromise
  if (!audio) return false
  try {
    audio.currentTime = 0
    await audio.play()
    return true
  } catch {
    return false
  }
}
