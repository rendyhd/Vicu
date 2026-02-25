import { useState, useRef, useEffect } from 'react'
import { Search } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { cn } from '@/lib/cn'

export function SearchBar() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  // Ctrl+F global listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // Auto-focus when opened
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const handleSubmit = () => {
    const trimmed = query.trim()
    if (trimmed) {
      navigate({ to: '/search', search: { q: trimmed } })
      setOpen(false)
      setQuery('')
    }
  }

  const handleClose = () => {
    setOpen(false)
    setQuery('')
  }

  return (
    <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} className="flex items-center mr-1">
      <div
        className={cn(
          'flex items-center transition-all duration-200 overflow-hidden rounded',
          open
            ? 'w-60 bg-[var(--bg-secondary)] border border-[var(--border-color)]'
            : 'w-7'
        )}
      >
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            'flex shrink-0 items-center justify-center rounded',
            open ? 'h-6 w-7' : 'h-7 w-7 hover:bg-[var(--bg-secondary)]'
          )}
          title={`Search tasks (${window.api.platform === 'darwin' ? '\u2318F' : 'Ctrl+F'})`}
        >
          <Search className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
        </button>
        {open && (
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit()
              if (e.key === 'Escape') handleClose()
            }}
            onBlur={() => {
              if (!query.trim()) handleClose()
            }}
            placeholder="Search tasks..."
            className="h-6 flex-1 bg-transparent pr-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none"
          />
        )}
      </div>
    </div>
  )
}
