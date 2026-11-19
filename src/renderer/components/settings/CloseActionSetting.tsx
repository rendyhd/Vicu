import { closeAction, type AppConfig, type CloseAction } from '@/lib/vikunja-types'

const OPTIONS: ReadonlyArray<{ value: CloseAction; label: string }> = [
  { value: 'minimize', label: 'Minimize to taskbar' },
  { value: 'tray', label: 'Hide to system tray' },
  { value: 'quit', label: 'Quit Vicu' },
]

const NOTES: Record<CloseAction, string> = {
  minimize: 'Vicu keeps its taskbar button, with the task count when that is on.',
  tray: 'Vicu keeps running in the tray; its icon brings the window back.',
  quit: 'Vicu stops, and Quick Entry and Quick View with it.',
}

/**
 * What the main window's close button does (Windows and Linux; macOS always hides to the Dock).
 * Unset shows what it does today: the tray while Quick Entry or Quick View is on, else quit.
 */
export function CloseActionSetting({
  config,
  onChange,
}: {
  config: AppConfig | null
  onChange: (patch: Partial<AppConfig>) => void
}) {
  const current = closeAction(config)
  return (
    <label className="flex items-center justify-between gap-4">
      <span>
        <span className="block text-sm text-[var(--text-primary)]">When closing the window</span>
        <span className="block text-xs text-[var(--text-secondary)]">{NOTES[current]}</span>
      </span>
      <select
        value={current}
        onChange={(e) => onChange({ close_action: e.target.value as CloseAction })}
        className="rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}
