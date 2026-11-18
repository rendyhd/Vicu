import { useRouter } from '@tanstack/react-router'
import { ArrowLeft, Bell, FolderTree, Gem, Keyboard, SlidersHorizontal, Sparkles, Zap, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { SETTINGS_GROUPS, type SettingsTab } from '@/lib/settings-menu'
import { useSettingsNavStore } from '@/stores/settings-nav-store'
import { SelectionPill } from '@/components/sidebar/SelectionPill'

const TAB_ICONS: Record<SettingsTab, LucideIcon> = {
  general: SlidersHorizontal,
  projects: FolderTree,
  notifications: Bell,
  integrations: Zap,
  assistant: Sparkles,
  pro: Gem,
  shortcuts: Keyboard,
}

/**
 * The Settings menu: the tabs in their groups, and under the open tab the sections of its page (the
 * one being read is marked; a click scrolls to it). `column` is drawn beside the settings, `sidebar`
 * in the app sidebar's place when the page is narrow, with Back to app above it (lib/settings-menu.ts).
 */
export function SettingsMenu({ variant }: { variant: 'column' | 'sidebar' }) {
  const tab = useSettingsNavStore((s) => s.tab)
  const setTab = useSettingsNavStore((s) => s.setTab)
  const sections = useSettingsNavStore((s) => s.sections)
  const current = useSettingsNavStore((s) => s.current)
  const jumpTo = useSettingsNavStore((s) => s.jumpTo)
  const router = useRouter()

  const backToApp = () => {
    if (router.history.canGoBack()) router.history.back()
    else void router.navigate({ to: '/inbox' })
  }

  return (
    <div className="isolate flex h-full flex-col">
      {variant === 'sidebar' && (
        <div className="px-2 pt-2">
          <button
            type="button"
            onClick={backToApp}
            className="flex h-8 w-full items-center gap-2.5 rounded-control px-2.5 text-section font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            <span>Back to app</span>
          </button>
        </div>
      )}
      <div className={cn('px-4 pb-1', variant === 'sidebar' ? 'pt-3' : 'pt-6')}>
        <span className="text-card-title text-[var(--text-primary)]">Settings</span>
      </div>
      <nav aria-label="Settings" className="flex-1 overflow-y-auto px-2 pb-3">
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.label} role="group" aria-label={group.label}>
            <div className="px-2.5 pb-1 pt-3 text-caption uppercase tracking-wider text-[var(--text-secondary)]" aria-hidden="true">
              {group.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.tabs.map((item) => {
                const Icon = TAB_ICONS[item.key]
                const active = item.key === tab
                return (
                  <div key={item.key}>
                    <button
                      type="button"
                      onClick={() => setTab(item.key)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'relative flex h-8 w-full items-center gap-2.5 rounded-control px-2.5 text-section font-medium text-[var(--text-primary)] transition-colors',
                        !active && 'hover:bg-[var(--bg-hover)]',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                      {active && <SelectionPill />}
                    </button>
                    {active && sections.length > 1 && (
                      <ul aria-label={`${item.label} sections`} className="mb-1 mt-0.5 flex flex-col">
                        {sections.map((label, index) => (
                          <li key={`${index}-${label}`}>
                            <button
                              type="button"
                              onClick={() => jumpTo?.(index)}
                              // A section can share its tab's name (Projects, Pro): the name says which it is.
                              aria-label={`${label} section`}
                              aria-current={index === current ? 'location' : undefined}
                              className={cn(
                                'relative flex h-7 w-full items-center rounded-control pl-[36px] pr-2.5 text-left text-meta transition-colors hover:bg-[var(--bg-hover)]',
                                index === current ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
                              )}
                            >
                              {/* The section being read has a bar too, not only a brighter label. */}
                              {index === current && (
                                <span aria-hidden="true" className="absolute left-[25px] top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-accent-blue" />
                              )}
                              <span className="min-w-0 truncate">{label}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
    </div>
  )
}
