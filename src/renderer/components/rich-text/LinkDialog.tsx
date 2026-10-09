import { useEffect, useId, useState } from 'react'
import { cn } from '@/lib/cn'
import { normalizeEditableLink } from '@/lib/description-html'
import { Dialog } from '@/components/overlay/Dialog'

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
  const titleId = useId()
  const [url, setUrl] = useState(initialUrl)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setUrl(initialUrl)
    setError(null)
  }, [open, initialUrl])

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
    <Dialog open onClose={onCancel} labelledBy={titleId} className="w-[calc(100%-2rem)] max-w-sm">
      <div className="p-5">
        <h2 id={titleId} className="mb-3 text-sm font-medium text-[var(--text-primary)]">
          {canRemove ? 'Edit link' : 'Add link'}
        </h2>
        <label className="mb-1 block text-xs text-[var(--text-secondary)]">URL</label>
        <input
          data-autofocus
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
            'mb-1 w-full rounded-control border bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)]',
            'placeholder:text-[var(--text-secondary)]',
            error ? 'border-danger' : 'border-[var(--border-color)]',
          )}
        />
        {error && (
          <p className="mb-3 text-xs text-danger">{error}</p>
        )}
        {!error && <div className="mb-3" />}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              'rounded-control border border-[var(--border-color)] px-4 py-1.5 text-sm font-medium',
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
                'rounded-control border border-[var(--border-color)] px-4 py-1.5 text-sm font-medium',
                'text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]',
              )}
            >
              Remove
            </button>
          )}
          <button
            type="button"
            onClick={handleApply}
            className="rounded-control bg-accent-fill px-4 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-fill/90"
          >
            Apply
          </button>
        </div>
      </div>
    </Dialog>
  )
}
