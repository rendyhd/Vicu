import { useState } from 'react'
import { RefreshCw, CheckCircle2 } from 'lucide-react'
import { useProjectsNeedingReview, useTrackedProjects } from '@/hooks/use-review'
import { ReviewListRow } from '@/components/review/ReviewListRow'

type Tab = 'due' | 'all'

export function ReviewView() {
  const [tab, setTab] = useState<Tab>('due')
  const due = useProjectsNeedingReview()
  const all = useTrackedProjects()

  const list = tab === 'due' ? due.data : all.data
  const isLoading = tab === 'due' ? due.isLoading : all.isLoading

  return (
    <div className="flex flex-col h-full">
      <header className="px-6 pt-6 pb-3 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-violet-500" />
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Review</h1>
        </div>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          {tab === 'due'
            ? `${due.data.length} project${due.data.length === 1 ? '' : 's'} due for review`
            : `${all.data.length} tracked project${all.data.length === 1 ? '' : 's'}`}
        </p>
        <div className="flex gap-1 mt-3" role="tablist">
          <TabButton active={tab === 'due'} onClick={() => setTab('due')}>Due</TabButton>
          <TabButton active={tab === 'all'} onClick={() => setTab('all')}>All tracked</TabButton>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-6 text-sm text-[var(--text-secondary)]">Loading…</div>
        )}
        {!isLoading && list.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
            <CheckCircle2 className="w-12 h-12 text-green-500 mb-3" />
            <p className="text-[var(--text-primary)] font-medium">
              {tab === 'due' ? 'All caught up' : 'No tracked projects'}
            </p>
            <p className="text-sm text-[var(--text-secondary)] mt-1 max-w-sm">
              {tab === 'due'
                ? 'No projects due for review. Switch to All tracked to manage cadence on individual projects.'
                : 'No non-archived projects to track. If review tracking is disabled in settings, enable it to see projects here.'}
            </p>
          </div>
        )}
        {!isLoading && list.map((item) => (
          <ReviewListRow key={item.project.id} item={item} />
        ))}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        'px-3 py-1.5 rounded-md text-sm font-medium ' +
        (active
          ? 'bg-[var(--accent-blue)] text-white'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]')
      }
    >
      {children}
    </button>
  )
}
