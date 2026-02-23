import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Settings } from 'lucide-react'
import { api } from '@/lib/api'

export function SidebarFooter() {
  const navigate = useNavigate()
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [checking, setChecking] = useState(false)
  const [latestVersion, setLatestVersion] = useState('')
  const [releaseUrl, setReleaseUrl] = useState('')

  useEffect(() => {
    api.getUpdateStatus().then((status) => {
      if (status?.available) {
        api.getConfig().then((config) => {
          if (config?.update_check_dismissed_version !== status.latestVersion) {
            setUpdateAvailable(true)
            setLatestVersion(status.latestVersion)
            setReleaseUrl(status.releaseUrl)
          }
        })
      }
    })

    const cleanup = api.onUpdateAvailable((status) => {
      if (status.available) {
        api.getConfig().then((config) => {
          if (config?.update_check_dismissed_version !== status.latestVersion) {
            setUpdateAvailable(true)
            setLatestVersion(status.latestVersion)
            setReleaseUrl(status.releaseUrl)
          }
        })
      }
    })

    return cleanup
  }, [])

  return (
    <div className="border-t border-[var(--border-color)] px-2 py-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => navigate({ to: '/settings' })}
          className="flex h-7 flex-1 items-center gap-2 rounded-md px-2.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <Settings className="h-3.5 w-3.5" strokeWidth={1.8} />
          <span>Settings</span>
        </button>
        <button
          type="button"
          onClick={async () => {
            if (updateAvailable && releaseUrl) {
              window.api.openDeepLink(releaseUrl)
            } else {
              setChecking(true)
              const status = await api.checkForUpdate()
              setChecking(false)
              if (status?.available) {
                setUpdateAvailable(true)
                setLatestVersion(status.latestVersion)
                setReleaseUrl(status.releaseUrl)
              }
            }
          }}
          className="relative flex h-7 items-center rounded-md px-2 text-[10px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          title={updateAvailable ? `v${latestVersion} available — click to download` : 'Click to check for updates'}
        >
          {checking ? 'checking…' : `v${__APP_VERSION__}`}
          {updateAvailable && (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[var(--accent-blue)]" />
          )}
        </button>
      </div>
    </div>
  )
}

declare const __APP_VERSION__: string
