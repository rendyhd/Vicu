import { useMemo } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { AlarmClock, ChevronRight, Inbox, ListChecks, MessageCircleQuestion, RefreshCw } from 'lucide-react'
import { startersFor } from '@/lib/ai/starters'
import { useProAssistantOn } from '@/hooks/use-pro-assistant'
import { PRO_AI } from '../../../shared/ai/contract'
import { useGuidedWorld } from '@/hooks/use-guided-world'
import { askAgenda, type AgendaItemId } from '../../../shared/guided'

// What a conversation without messages starts with (docs/ai-assistant-v1.md section 5.7): the
// agenda (cross-app semantics 14.8), built on the device, each item opening its guided session,
// then the starters for the list Ask was opened from, each sent exactly as written.

const ROUTES: Record<AgendaItemId, string> = {
  inbox: '/guided/inbox',
  overdue: '/guided/overdue',
  review: '/guided/review',
  weekly: '/weekly-review',
}

const ICONS: Record<AgendaItemId, typeof Inbox> = {
  inbox: Inbox,
  overdue: AlarmClock,
  review: RefreshCw,
  weekly: ListChecks,
}

export function AskAgenda({ onSend, disabled }: { onSend: (text: string) => void; disabled?: boolean }) {
  const data = useGuidedWorld()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const items = useMemo(() => (data.world ? askAgenda(data.world, data.weeklyReviewLast) : []), [data.world, data.weeklyReviewLast])
  // Pro's starters (ai-assistant 11.3) while Pro's assistant is on, after the list's own.
  const proStarters = useProAssistantOn() ? PRO_AI.starters : []
  const starters = [...startersFor(pathname, data.world?.inboxId ?? 0), ...proStarters]

  return (
    <div className="space-y-4">
      {items.length > 0 && (
        <section aria-labelledby="ask-agenda">
          <h2 id="ask-agenda" className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Needs a decision</h2>
          <ul className="space-y-1">
            {items.map((item) => {
              const Icon = ICONS[item.id]
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void navigate({ to: ROUTES[item.id] })}
                    className="flex w-full items-center gap-2.5 rounded-control border border-[var(--border-color)] px-2.5 py-2 text-left transition-colors duration-fade-fast hover:bg-[var(--bg-hover)]"
                  >
                    <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-task-title text-[var(--text-primary)]">
                        {item.title}
                        {item.count !== null && <span className="ml-1.5 text-meta tabular-nums text-[var(--text-secondary)]">{item.count}</span>}
                      </span>
                      {item.detail && <span className="block text-caption text-[var(--text-secondary)]">{item.detail}</span>}
                    </span>
                    <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <section aria-labelledby="ask-starters">
        <h2 id="ask-starters" className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Ask</h2>
        <ul className="flex flex-col items-start gap-1.5">
          {starters.map((text) => (
            <li key={text}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSend(text)}
                className="flex items-center gap-2 rounded-chip border border-[var(--border-color)] px-2.5 py-1 text-left text-meta text-[var(--text-primary)] transition-colors duration-fade-fast hover:bg-[var(--bg-hover)] disabled:opacity-50"
              >
                <MessageCircleQuestion aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-accent-blue" />
                {text}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
