import { useState } from 'react'
import { CheckCircle2, MoreHorizontal, Loader2 } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { formatLastReviewedLabel, formatStatusPill } from '@/lib/review-metadata'
import {
  useMarkReviewed,
  useSetReviewCadence,
  useExcludeFromReview,
  type ProjectWithStatus,
} from '@/hooks/use-review'

interface ReviewListRowProps {
  item: ProjectWithStatus
}

const PILL_TONE: Record<ReturnType<typeof formatStatusPill>['tone'], string> = {
  red: 'bg-red-500/15 text-red-500',
  amber: 'bg-amber-500/15 text-amber-600',
  gray: 'bg-gray-500/15 text-gray-500',
  'gray-muted': 'bg-gray-300/30 text-gray-400',
}

export function ReviewListRow({ item }: ReviewListRowProps) {
  const { project, status } = item
  const pill = formatStatusPill(status)
  const navigate = useNavigate()
  const mark = useMarkReviewed()
  const setCadence = useSetReviewCadence()
  const exclude = useExcludeFromReview()
  const isMutating = mark.isPending || setCadence.isPending || exclude.isPending

  const [menuOpen, setMenuOpen] = useState(false)
  const [cadenceOpen, setCadenceOpen] = useState(false)
  const [cadenceInput, setCadenceInput] = useState<string>(
    String(status.metadata.cadenceDaysOverride ?? ''),
  )

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
      <button
        type="button"
        className="flex-1 text-left"
        onClick={() => navigate({ to: '/project/$projectId', params: { projectId: String(project.id) } })}
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: project.hex_color || '#888' }}
          />
          <span className="font-medium text-[var(--text-primary)]">{project.title}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${PILL_TONE[pill.tone]}`}>{pill.label}</span>
        </div>
        <div className="text-xs text-[var(--text-secondary)] mt-1">{formatLastReviewedLabel(status)}</div>
      </button>

      <button
        type="button"
        disabled={isMutating}
        onClick={() => mark.mutate({ project })}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--accent-blue)] text-white text-sm font-medium disabled:opacity-50"
      >
        {isMutating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
        Mark reviewed
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="p-1.5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-full mt-1 z-10 w-44 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-lg py-1"
            onMouseLeave={() => setMenuOpen(false)}
          >
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-hover)]"
              onClick={() => { setMenuOpen(false); setCadenceOpen(true) }}
            >
              Set cadence…
            </button>
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-hover)] text-red-500"
              onClick={() => { setMenuOpen(false); exclude.mutate({ project, excluded: true }) }}
            >
              Exclude from review tracking
            </button>
          </div>
        )}
        {cadenceOpen && (
          <div className="absolute right-0 top-full mt-1 z-10 w-52 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-lg p-3 space-y-2">
            <label className="block text-xs text-[var(--text-secondary)]">
              Cadence in days (blank = use default)
            </label>
            <input
              type="number"
              min={1}
              max={365}
              value={cadenceInput}
              onChange={(e) => setCadenceInput(e.target.value)}
              className="w-full px-2 py-1 rounded border border-[var(--border-color)] bg-[var(--bg-primary)]"
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 px-2 py-1 text-sm rounded bg-[var(--accent-blue)] text-white"
                onClick={() => {
                  const n = cadenceInput === '' ? null : parseInt(cadenceInput, 10)
                  setCadence.mutate({ project, cadenceDays: Number.isFinite(n ?? NaN) ? n : null })
                  setCadenceOpen(false)
                }}
              >
                Save
              </button>
              <button
                type="button"
                className="px-2 py-1 text-sm rounded border border-[var(--border-color)]"
                onClick={() => setCadenceOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
