import { useNavigate, useParams, useRouter, useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { GuidedSortSession } from '@/components/guided/GuidedSortSession'
import { ProjectReviewSession } from '@/components/guided/ProjectReviewSession'
import { useWeeklyReviewStore } from '@/stores/weekly-review-store'
import type { GuidedQueueId, GuidedSessionId } from '../../shared/guided'

// A guided session on its own page (docs/cross-app-semantics-v1.md section 14): the card sessions
// `inbox`, `overdue` and `waiting`, and the project review. Opened from the Inbox header, the Review
// view, the command palette, Ask's agenda and the weekly review (`?from=weekly`, which it goes back
// to and whose step it marks done).

const SESSIONS: readonly GuidedSessionId[] = ['inbox', 'overdue', 'waiting', 'review']

/** Where Exit goes when the session was not opened from somewhere it can go back to. */
const HOME: Record<GuidedSessionId, string> = { inbox: '/inbox', overdue: '/today', waiting: '/anytime', review: '/review' }

export function isGuidedSession(value: string): value is GuidedSessionId {
  return (SESSIONS as readonly string[]).includes(value)
}

export function GuidedView() {
  const { t } = useTranslation()
  const { session } = useParams({ from: '/guided/$session' })
  const { from } = useSearch({ from: '/guided/$session' })
  const navigate = useNavigate()
  const router = useRouter()
  const markDone = useWeeklyReviewStore((s) => s.markDone)
  const id: GuidedSessionId = isGuidedSession(session) ? session : 'inbox'
  const weekly = from === 'weekly'

  const leave = () => {
    if (weekly) void navigate({ to: '/weekly-review' })
    else if (window.history.length > 1) router.history.back()
    else void navigate({ to: HOME[id] })
  }

  const done = (summary: string) => {
    if (weekly) markDone(id, summary)
    leave()
  }

  const doneLabel = weekly ? t('guided.backToWeekly') : t('guided.done')
  if (id === 'review') return <ProjectReviewSession key={id} onExit={leave} onDone={done} doneLabel={doneLabel} />
  return <GuidedSortSession key={id} queueId={id as GuidedQueueId} onExit={leave} onDone={done} doneLabel={doneLabel} />
}
