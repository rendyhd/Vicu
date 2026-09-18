import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { normalizeEditableLink } from '@/lib/description-html'

interface LinkDialogProps {
  open: boolean
  initialUrl: string
  canRemove: boolean
  onApply: (url: string) => void
  onRemove: () => void
  onCancel: () => void
}

export function LinkDialog({
  open,
  initialUrl,
  canRemove,
  onApply,
  onRemove,
  onCancel,
}: LinkDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState(initialUrl)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setUrl(initialUrl)
    setError(null)
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open, initialUrl])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => document.removeEventListener('keydown', handleKey, true)
  }, [open, onCancel])

  if (!open) return null

  const handleApply = () => {
    const trimmed = url.trim()
    if (trimmed === '') {
      if (canRemove) {
        onRemove()
        return
      }
      setError('Enter a URL')
      return
    }
    const normalized = normalizeEditableLink(trimmed)
    if (!normalized) {
      setError('Use an http://, https://, or mailto: link.')
      return
    }
    onApply(normalized)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-medium text-[var(--text-primary)]">
          {canRemove ? 'Edit link' : 'Add link'}
        </h2>
        <label className="mb-1 block text-xs text-[var(--text-secondary)]">URL</label>
        <input
          ref={inputRef}
          type="text"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleApply()
            }
          }}
          placeholder="https://example.com"
          className={cn(
            'mb-1 w-full rounded-md border bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)]',
            'placeholder:text-[var(--text-secondary)] focus:outline-none focus:ring-1',
            error
              ? 'border-[var(--accent-red)] focus:ring-[var(--accent-red)]'
              : 'border-[var(--border-color)] focus:ring-[var(--accent-blue)]',
          )}
        />
        {error && (
          <p className="mb-3 text-xs text-[var(--accent-red)]">{error}</p>
        )}
        {!error && <div className="mb-3" />}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              'rounded-md border border-[var(--border-color)] px-4 py-1.5 text-sm font-medium',
              'text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]',
            )}
          >
            Cancel
          </button>
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              className={cn(
                'rounded-md border border-[var(--border-color)] px-4 py-1.5 text-sm font-medium',
                'text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]',
              )}
            >
              Remove
            </button>
          )}
          <button
            type="button"
            onClick={handleApply}
            className="rounded-md bg-accent-blue px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-blue/90"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
