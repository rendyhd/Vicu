import { useRef, useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { useAddAssignee, useRemoveAssignee } from '@/hooks/use-task-mutations'
import { api } from '@/lib/api'
import type { VikunjaUser } from '@/lib/vikunja-types'

interface AssigneePickerPopoverProps {
  taskId: number
  currentAssignees: VikunjaUser[]
  onClose: () => void
}

export function AssigneePickerPopover({ taskId, currentAssignees, onClose }: AssigneePickerPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<VikunjaUser[]>([])
  const addAssignee = useAddAssignee()
  const removeAssignee = useRemoveAssignee()

  const currentIds = new Set(currentAssignees.map((u) => u.id))

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  // Load users on mount and on search query change (debounced)
  useEffect(() => {
    const timer = setTimeout(async () => {
      const result = await api.searchUsers(searchQuery)
      if (result.success && Array.isArray(result.data)) setSearchResults(result.data as VikunjaUser[])
    }, 150)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const toggle = (user: VikunjaUser) => {
    if (currentIds.has(user.id)) {
      removeAssignee.mutate({ taskId, userId: user.id })
    } else {
      addAssignee.mutate({ taskId, userId: user.id })
    }
  }

  // Merge current assignees with search results (current always shown, no dupes)
  const merged: VikunjaUser[] = [...currentAssignees]
  for (const u of searchResults) {
    if (!currentIds.has(u.id)) merged.push(u)
  }

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-lg"
    >
      <div className="border-b border-[var(--border-color)] px-3 py-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search members..."
          autoFocus
          className="w-full bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none"
        />
      </div>

      <div className="max-h-60 overflow-y-auto py-1">
        {merged.length === 0 && (
          <div className="px-3 py-2 text-xs text-[var(--text-secondary)]">No members found</div>
        )}

        {merged.map((user) => {
          const display = user.name?.trim() || user.username
          const initials = display
            .split(' ')
            .map((w) => w[0])
            .slice(0, 2)
            .join('')
            .toUpperCase()
          const isAssigned = currentIds.has(user.id)

          return (
            <button
              key={user.id}
              type="button"
              onClick={() => toggle(user)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-blue)]/20 text-[9px] font-semibold text-[var(--accent-blue)]">
                {initials}
              </span>
              <span className="min-w-0 flex-1 truncate">{display}</span>
              {isAssigned && (
                <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent-blue)]" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
