import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Plus, UsersRound } from 'lucide-react'
import { cn } from '@/lib/cn'
import { SelectionPill } from './SelectionPill'
import { useGroups } from '@/hooks/use-groups'
import { GroupDialog } from '@/components/pro/GroupDialog'

const ROW = 'relative flex h-8 items-center gap-2.5 rounded-control px-2.5 text-section font-medium text-text transition-colors'

/**
 * Pro's groups in the sidebar (cross-app semantics 21.16), under Pro's lists: one row per group,
 * and a quiet row that makes a new one. Nothing while the promises layer is off.
 */
export function GroupNav({ currentPath }: { currentPath: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { on, groups } = useGroups()
  const [adding, setAdding] = useState(false)
  if (!on) return null
  const open = (labelId: number) => void navigate({ to: '/group/$labelId', params: { labelId: String(labelId) } })
  return (
    <>
      {groups.map((group) => {
        const path = `/group/${group.label}`
        const isActive = currentPath === path || currentPath.startsWith(`/session/${group.id}/`)
        return (
          <button
            key={group.id}
            type="button"
            onClick={() => open(group.label)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(ROW, !isActive && 'hover:bg-[var(--bg-hover)]')}
            data-pro-group-nav={group.label}
          >
            <UsersRound className="h-4 w-4 text-accent-teal" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-left">{group.name}</span>
            {isActive && <SelectionPill />}
          </button>
        )
      })}
      <button type="button" onClick={() => setAdding(true)} className={cn(ROW, 'font-normal text-text-secondary hover:bg-[var(--bg-hover)] hover:text-text')} data-pro-new-group>
        <Plus className="h-4 w-4" aria-hidden />
        <span className="flex-1 text-left">{t('pro.group.nav.new')}</span>
      </button>
      {adding && <GroupDialog onClose={() => setAdding(false)} onSaved={open} />}
    </>
  )
}
