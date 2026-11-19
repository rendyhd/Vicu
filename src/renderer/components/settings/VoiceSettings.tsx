import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { t } from '../../../shared/i18n'
import { HotkeyRecorder } from './HotkeyRecorder'
import type { AppConfig } from '@/lib/vikunja-types'
import { voiceHotkeyConflict } from '@/lib/voice/shortcut-conflicts'
import type { VoiceAvailability } from '../../../shared/voice-types'

const isMac = window.api.platform === 'darwin'

interface VoiceSettingsProps {
  config: AppConfig
  onChange: (partial: Partial<AppConfig>) => void
}

function engineText(availability: VoiceAvailability | null): string {
  if (!availability) return t('settings.voice.checking')
  if (!availability.available) return availability.reason ?? t('settings.voice.unavailable')
  const engine = availability.engine === 'macos-speech' ? t('settings.voice.engineMacos') : t('settings.voice.engineWindows')
  return availability.onDevice
    ? t('settings.voice.onDevice', { engine })
    : t('settings.voice.servers', { engine })
}

/** Settings, Keyboard Shortcuts: the in-app voice shortcut (docs/voice-input.md). */
export function VoiceSettings({ config, onChange }: VoiceSettingsProps) {
  const { t } = useTranslation()
  const [availability, setAvailability] = useState<VoiceAvailability | null>(null)
  useEffect(() => {
    let live = true
    window.api.voice.availability().then((value) => { if (live) setAvailability(value) }).catch(() => {
      if (live) setAvailability({ available: false, engine: 'none', onDevice: false })
    })
    return () => { live = false }
  }, [])

  // No default: the shortcut is off until the user records one.
  const hotkey = config.voice_hotkey ?? ''
  const conflict = voiceHotkeyConflict(hotkey, config, isMac)

  return (
    <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('settings.voice.title')}</h2>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        {t('settings.voice.intro')}
      </p>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        {t('settings.voice.smart')}
      </p>
      <p className="mt-2 text-xs text-[var(--text-secondary)]" data-voice-engine="">{engineText(availability)}</p>

      <div className="mt-4">
        <label className="mb-1 block text-xs text-[var(--text-secondary)]">{t('settings.voice.shortcut')}</label>
        <HotkeyRecorder
          value={hotkey}
          onChange={(value) => onChange({ voice_hotkey: value })}
          onClear={() => onChange({ voice_hotkey: '' })}
          defaultValue=""
          emptyText={t('settings.voice.notSet')}
          label={t('settings.voice.shortcutLabel')}
          warning={conflict !== null}
        />
        {conflict && <p className="mt-1 text-xs text-status-today">{conflict}</p>}
      </div>
    </div>
  )
}
