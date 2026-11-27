import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { api } from '@/lib/api'

interface UpdateInfo {
  available: boolean
  currentVersion: string
  latestVersion: string
  releaseUrl: string
}

export function UpdateBanner() {
  const { t } = useTranslation()
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Check cached status on mount
    api.getUpdateStatus().then((status) => {
      if (status?.available) {
        api.getConfig().then((config) => {
          if (config?.update_check_dismissed_version !== status.latestVersion) {
            setUpdate(status)
          }
        })
      }
    })

    // Listen for push notification from main process
    const cleanup = api.onUpdateAvailable((status) => {
      if (status.available) {
        api.getConfig().then((config) => {
          if (config?.update_check_dismissed_version !== status.latestVersion) {
            setUpdate(status)
            setDismissed(false)
          }
        })
      }
    })

    return cleanup
  }, [])

  if (!update || dismissed) return null

  return (
    <div className="flex items-center gap-3 border-b border-[var(--border-color)] bg-accent-blue/10 px-4 py-2">
      <span className="flex-1 text-xs text-[var(--text-primary)]">
        <Trans i18nKey="app.update.available" values={{ version: update.latestVersion }} components={{ version: <span className="font-medium" /> }} />
      </span>
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault()
          window.api.openDeepLink(update.releaseUrl)
        }}
        className="flex items-center gap-1 rounded-control px-2 py-1 text-xs font-medium text-[var(--accent-blue)] transition-colors hover:bg-accent-blue/20"
      >
        <Download className="h-3 w-3" />
        {t('app.update.download')}
      </a>
      <button
        type="button"
        onClick={() => {
          setDismissed(true)
          api.dismissUpdate(update.latestVersion)
        }}
        className="flex h-5 w-5 items-center justify-center rounded-control text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        aria-label={t('app.update.dismiss')}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
