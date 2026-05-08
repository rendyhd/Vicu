import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { reloadCompletionSound, playCompletionSound } from '@/lib/completion-sound'
import type { AppConfig } from '@/lib/vikunja-types'

interface SoundInfo {
  fileName: string
  isDefault: boolean
}

interface Props {
  config: AppConfig
  onChange: (partial: Partial<AppConfig>) => void
}

export function CompletionSoundSettings({ config, onChange }: Props) {
  const enabled = config.task_completion_sound_enabled !== false
  const [info, setInfo] = useState<SoundInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshInfo = async () => {
    const data = await api.getCompletionSoundInfo()
    setInfo({ fileName: data.fileName, isDefault: data.isDefault })
  }

  useEffect(() => { void refreshInfo() }, [config.task_completion_sound_path])

  const handleChooseFile = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.pickCompletionSound()
      if (result.success) {
        onChange({ task_completion_sound_path: result.path })
        await reloadCompletionSound()
        await refreshInfo()
      } else if (result.error !== 'cancelled') {
        setError(result.error)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleReset = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.resetCompletionSound()
      onChange({ task_completion_sound_path: null })
      await reloadCompletionSound()
      await refreshInfo()
    } finally {
      setBusy(false)
    }
  }

  const handleTest = () => {
    playCompletionSound()
  }

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
      <h2 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Task Completion Sound</h2>

      <div className="space-y-3">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onChange({ task_completion_sound_enabled: e.target.checked })}
            className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
          />
          <span className="text-sm text-[var(--text-primary)]">
            Play a sound when completing a task
          </span>
        </label>

        <div className={cn('space-y-2 transition-opacity', !enabled && 'pointer-events-none opacity-50')}>
          <div className="text-xs text-[var(--text-secondary)]">
            Current sound:{' '}
            <span className="font-mono text-[var(--text-primary)]">
              {info ? info.fileName : '...'}
            </span>
            {info?.isDefault && (
              <span className="ml-1 text-[var(--text-secondary)]">(default)</span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleChooseFile}
              disabled={busy}
              className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-accent-blue hover:text-accent-blue disabled:opacity-50"
            >
              Choose file...
            </button>
            {info && !info.isDefault && (
              <button
                type="button"
                onClick={handleReset}
                disabled={busy}
                className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-accent-blue hover:text-accent-blue disabled:opacity-50"
              >
                Reset to default
              </button>
            )}
            <button
              type="button"
              onClick={handleTest}
              disabled={busy}
              className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-accent-blue hover:text-accent-blue disabled:opacity-50"
            >
              Test
            </button>
          </div>

          {error && <p className="text-xs text-accent-red">{error}</p>}

          <p className="text-xs text-[var(--text-secondary)]">
            Supported: MP3, WAV, OGG, M4A, AAC, FLAC (max 10MB)
          </p>
        </div>
      </div>
    </div>
  )
}
