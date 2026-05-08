import { api } from '@/lib/api'

let audio: HTMLAudioElement | null = null
let objectUrl: string | null = null
let loadingPromise: Promise<void> | null = null
let enabled = true

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
  try {
    audio.currentTime = 0
    void audio.play().catch(() => { /* ignore autoplay/decode errors */ })
  } catch { /* ignore */ }
}
