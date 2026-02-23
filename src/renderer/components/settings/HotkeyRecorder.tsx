import { useRef, useState, useCallback, useEffect } from 'react'

/**
 * Maps KeyboardEvent.code to Electron accelerator key name.
 * Uses e.code (physical key) instead of e.key (character) to avoid
 * macOS character composition issues with Alt/Option key.
 */
function codeToAcceleratorKey(code: string): string | null {
  if (code.startsWith('Key') && code.length === 4) return code.slice(3)
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  if (code.startsWith('Arrow')) return code.slice(5)
  if (code.startsWith('Numpad') && code.length === 7 && /\d$/.test(code)) return 'num' + code.slice(6)

  const numpadMap: Record<string, string> = {
    NumpadAdd: 'numadd',
    NumpadSubtract: 'numsub',
    NumpadMultiply: 'nummult',
    NumpadDivide: 'numdiv',
    NumpadDecimal: 'numdec',
    NumpadEnter: 'Enter',
  }
  if (numpadMap[code]) return numpadMap[code]

  const directMap: Record<string, string> = {
    Space: 'Space', Enter: 'Enter', Tab: 'Tab', Escape: 'Escape',
    Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  }
  if (directMap[code]) return directMap[code]

  const punctuationMap: Record<string, string> = {
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`',
    Comma: ',', Period: '.', Slash: '/',
  }
  if (punctuationMap[code]) return punctuationMap[code]

  return null
}

const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
  'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight',
])

const isMacRenderer = window.api.platform === 'darwin'

function keyEventToAccelerator(e: KeyboardEvent): string | null {
  const parts: string[] = []
  if (isMacRenderer) {
    if (e.metaKey) parts.push('Command')
    if (e.ctrlKey) parts.push('Ctrl')
  } else {
    if (e.ctrlKey) parts.push('Ctrl')
  }
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  if (MODIFIER_CODES.has(e.code)) return null
  if (parts.length === 0) return null

  const key = codeToAcceleratorKey(e.code)
  if (!key) return null

  parts.push(key)
  return parts.join('+')
}

/** Convert Electron accelerator strings to macOS symbols for display */
function formatAcceleratorForDisplay(accelerator: string): string {
  if (!isMacRenderer) return accelerator
  return accelerator
    .replace(/Command\+?/g, '\u2318')
    .replace(/Ctrl\+?/g, '\u2303')
    .replace(/Alt\+?/g, '\u2325')
    .replace(/Shift\+?/g, '\u21E7')
}

interface HotkeyRecorderProps {
  value: string
  onChange: (value: string) => void
  defaultValue: string
  warning?: boolean
}

export function HotkeyRecorder({ value, onChange, defaultValue, warning }: HotkeyRecorderProps) {
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
      onChange(prevValueRef.current || defaultValue)
    }
  }, [onChange, defaultValue])

  useEffect(() => {
    if (!recording) return
    const input = inputRef.current
    if (!input) return

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const accelerator = keyEventToAccelerator(e)
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
        readOnly
        value={recording ? '' : formatAcceleratorForDisplay(value)}
        placeholder={recording ? 'Press keys...' : undefined}
        className={`flex-1 rounded-md border px-3 py-2 text-sm focus:outline-none ${
          warning
            ? 'border-accent-orange bg-[var(--bg-secondary)] text-[var(--text-primary)]'
            : 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-primary)] focus:border-accent-blue'
        }`}
      />
      <button
        type="button"
        onClick={startRecording}
        className={`shrink-0 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
          recording
            ? 'border-accent-blue bg-accent-blue text-white'
            : 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
        }`}
      >
        {recording ? 'Press keys...' : 'Record'}
      </button>
    </div>
  )
}
