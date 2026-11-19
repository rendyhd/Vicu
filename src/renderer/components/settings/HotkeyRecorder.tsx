import { useRef, useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { formatAcceleratorForDisplay, keyEventToAccelerator } from '@/lib/accelerator'

const isMacRenderer = window.api.platform === 'darwin'

interface HotkeyRecorderProps {
  value: string
  onChange: (value: string) => void
  defaultValue: string
  warning?: boolean
  /** The accessible name of the field. */
  label?: string
  /** What the field says when no hotkey is set. */
  emptyText?: string
  /** When given, a Clear button sets the hotkey to '' (off). */
  onClear?: () => void
}

export function HotkeyRecorder({ value, onChange, defaultValue, warning, label, emptyText = '', onClear }: HotkeyRecorderProps) {
  const { t } = useTranslation()
  const [recording, setRecording] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const prevValueRef = useRef(value)

  const startRecording = useCallback(() => {
    if (recording) return
    prevValueRef.current = value
    setRecording(true)
    inputRef.current?.focus()
  }, [recording, value])

  const stopRecording = useCallback((revert: boolean) => {
    setRecording(false)
    if (revert) {
      // A hotkey that can be off goes back to off; the others never end up empty.
      onChange(onClear ? prevValueRef.current : prevValueRef.current || defaultValue)
    }
  }, [onChange, defaultValue, onClear])

  useEffect(() => {
    if (!recording) return
    const input = inputRef.current
    if (!input) return

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const accelerator = keyEventToAccelerator(e, isMacRenderer)
      if (!accelerator) return
      onChange(accelerator)
      setRecording(false)
    }

    const handleBlur = () => {
      stopRecording(true)
    }

    input.addEventListener('keydown', handleKeyDown)
    input.addEventListener('blur', handleBlur)
    return () => {
      input.removeEventListener('keydown', handleKeyDown)
      input.removeEventListener('blur', handleBlur)
    }
  }, [recording, onChange, stopRecording])

  return (
    <div className="flex gap-2">
      <input
        ref={inputRef}
        type="text"
        data-hotkey-recorder=""
        aria-label={label ?? t('settings.hotkey.label')}
        readOnly
        value={recording ? '' : value ? formatAcceleratorForDisplay(value, isMacRenderer) : emptyText}
        placeholder={recording ? t('settings.hotkey.pressKeys') : undefined}
        className={`flex-1 rounded-control border px-3 py-2 text-sm ${
          warning
            ? 'border-status-today bg-[var(--bg-secondary)] text-[var(--text-primary)]'
            : 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-primary)]'
        }`}
      />
      <button
        type="button"
        onClick={startRecording}
        className={`shrink-0 rounded-control border px-3 py-2 text-xs font-medium transition-colors ${
          recording
            ? 'border-accent-fill bg-accent-fill text-on-accent'
            : 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
        }`}
      >
        {recording ? t('settings.hotkey.pressKeys') : t('settings.hotkey.record')}
      </button>
      {onClear && value && !recording && (
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          {t('settings.hotkey.clear')}
        </button>
      )}
    </div>
  )
}
