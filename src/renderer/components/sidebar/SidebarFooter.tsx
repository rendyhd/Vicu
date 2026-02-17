import { useNavigate } from '@tanstack/react-router'
import { Settings } from 'lucide-react'

export function SidebarFooter() {
  const navigate = useNavigate()

  return (
    <div className="border-t border-[var(--border-color)] px-2 py-2">
      <button
        type="button"
        onClick={() => navigate({ to: '/settings' })}
        className="flex h-7 w-full items-center gap-2 rounded-md px-2.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      >
        <Settings className="h-3.5 w-3.5" strokeWidth={1.8} />
        <span>Settings</span>
      </button>
    </div>
  )
}
