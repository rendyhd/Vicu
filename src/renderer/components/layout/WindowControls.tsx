import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'

export function WindowControls() {
  if (window.api.platform === 'darwin') return null

  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    api.windowIsMaximized().then(setMaximized)
    const cleanup = api.onWindowMaximizedChange(setMaximized)
    return cleanup
  }, [])

  const handleMinimize = useCallback(() => api.windowMinimize(), [])
  const handleMaximize = useCallback(() => api.windowMaximize(), [])
  const handleClose = useCallback(() => api.windowClose(), [])

  const btnBase =
    'inline-flex items-center justify-center w-[46px] h-8 text-[var(--text-secondary)] transition-colors'

  return (
    <div className="flex" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button
        type="button"
        className={`${btnBase} hover:bg-[var(--bg-hover)]`}
        onClick={handleMinimize}
        aria-label="Minimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
          <rect width="10" height="1" />
        </svg>
      </button>

      <button
        type="button"
        className={`${btnBase} hover:bg-[var(--bg-hover)]`}
        onClick={handleMaximize}
        aria-label={maximized ? 'Restore' : 'Maximize'}
      >
        {maximized ? (
          // Restore icon (overlapping rectangles)
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="2" y="3" width="7" height="7" rx="0.5" />
            <path d="M3 3V1.5a.5.5 0 0 1 .5-.5H9.5a.5.5 0 0 1 .5.5V7.5a.5.5 0 0 1-.5.5H8" />
          </svg>
        ) : (
          // Maximize icon (single rectangle)
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" />
          </svg>
        )}
      </button>

      <button
        type="button"
        className={`${btnBase} hover:bg-red-500 hover:text-white`}
        onClick={handleClose}
        aria-label="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M1 1l8 8M9 1l-8 8" />
        </svg>
      </button>
    </div>
  )
}
