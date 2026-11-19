import { useTranslation } from 'react-i18next'
import { Checkbox } from '@/components/shared/Checkbox'
import { SmartListIcon } from '@/components/shared/SmartListIcon'
import { useSmartLists } from '@/components/sidebar/SmartListNav'
import {
  SIDEBAR_HIDEABLE_LISTS,
  isHiddenFromSidebar,
  withSidebarListHidden,
  type AppConfig,
  type SidebarHideableList,
} from '@/lib/vikunja-types'

interface SidebarSettingsProps {
  config: AppConfig
  onChange: (partial: Partial<AppConfig>) => void
}

const isHideable = (id: string): id is SidebarHideableList => (SIDEBAR_HIDEABLE_LISTS as readonly string[]).includes(id)

/**
 * Settings → General → Sidebar: which smart lists the sidebar shows above the projects. Routines
 * and Review are offered while they are on; the Inbox always stays. A hidden list keeps working.
 */
export function SidebarSettings({ config, onChange }: SidebarSettingsProps) {
  const { t } = useTranslation()
  const lists = useSmartLists().flatMap((item) => (isHideable(item.id) ? [{ ...item, id: item.id }] : []))

  return (
    <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">{t('settings.sidebar.title')}</h2>
      <p className="mb-4 text-xs text-[var(--text-secondary)]">
        {t('settings.sidebar.note')}
      </p>

      <div className="space-y-3">
        {lists.map((item) => (
          <label key={item.id} className="flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={!isHiddenFromSidebar(config, item.id)}
              onChange={(e) => onChange({ sidebar_hidden_lists: withSidebarListHidden(config, item.id, !e.target.checked) })}
            />
            <SmartListIcon list={item.id} className="h-4 w-4" />
            <span className="text-sm text-[var(--text-primary)]">{item.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
