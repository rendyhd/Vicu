import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelLeft } from 'lucide-react'
import { cn } from '@/lib/cn'
import { shortcutHint } from '@/lib/shortcut-hint'
import { toggleSidebar } from '@/stores/sidebar-store'

/** The keys that show or hide the sidebar (AppShell listens for them). */
export const SIDEBAR_SHORTCUT = 'Mod+\\'

/**
 * The sidebar button in the title band, at the window's top left (after the traffic lights on a
 * Mac). In a wide window it shows or hides the sidebar; in a narrow one it opens and closes the
 * drawer, and it stays above the drawer so the same place closes it (rendyhd/Vicu#73).
 */
export const SidebarToggle = forwardRef<HTMLButtonElement, { shown: boolean; controls: string }>(
  function SidebarToggle({ shown, controls }, ref) {
    const { t } = useTranslation()
    const shortcut = shortcutHint(SIDEBAR_SHORTCUT, window.api.platform === 'darwin')
    return (
      <button
        ref={ref}
        type="button"
        aria-label={shown ? t('sidebar.hide') : t('sidebar.show')}
        title={shown ? t('sidebar.hideShortcut', { shortcut }) : t('sidebar.showShortcut', { shortcut })}
        aria-expanded={shown}
        aria-controls={controls}
        data-sidebar-toggle
        onClick={toggleSidebar}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className={cn(
          'my-1 flex h-6 w-7 shrink-0 items-center justify-center rounded-control text-text-secondary transition-colors duration-fade-fast hover:bg-bg-hover hover:text-text',
        )}
      >
        <PanelLeft aria-hidden="true" className="h-4 w-4" />
      </button>
    )
  },
)
