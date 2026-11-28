import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { setRecord, writeLedger } from '@/hooks/use-pro-ledger'
import type { Task } from '@/lib/vikunja-types'

/**
 * A group's actions nobody owns yet (cross-app semantics 21.16): each with a button that makes it
 * your own action for the group. Giving it to a person is the task's Promise chip.
 */
export function NoOwnerList({ tasks, group }: { tasks: readonly Task[]; group: number }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  if (tasks.length === 0) return null
  return (
    <section className="mx-6 mb-4 rounded-card border border-border p-3" aria-label={t('pro.group.withoutOwner')} data-pro-no-owner>
      <h2 className="text-group text-text-secondary">{t('pro.group.withoutOwner')}</h2>
      <p className="mb-1 text-caption text-text-secondary">{t('pro.group.withoutOwnerHint')}</p>
      <ul className="divide-y divide-border">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-2 py-1 text-meta text-text">
            <span className="min-w-0 flex-1 truncate">{task.title}</span>
            <button
              type="button"
              className="shrink-0 rounded-control border border-border px-2 py-0.5 text-meta text-text hover:bg-bg-hover"
              onClick={() => void writeLedger(queryClient, [setRecord('promises', task.id, { dir: 'mine', person: null, to: { group } })])}
              data-pro-take={task.id}
            >
              {t('pro.group.takeIt')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
