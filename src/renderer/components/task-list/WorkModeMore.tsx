import { useTranslation } from 'react-i18next'
import type { WorkMode } from '../../../shared/work-scope'

/**
 * One quiet line under a project or label screen when Work and Personal hides some of its tasks
 * (cross-app semantics 22.4): "3 more in Personal" with a button that shows them until the view is
 * left. Nothing is drawn when nothing is hidden.
 */
export function WorkModeMore({ count, mode, onShow }: { count: number; mode: WorkMode; onShow: () => void }) {
  const { t } = useTranslation()
  if (count <= 0 || mode === 'all') return null
  // In Work the hidden tasks are the personal ones, and the other way round.
  const text = mode === 'work' ? t('workMode.moreInPersonal', { count }) : t('workMode.moreInWork', { count })
  return (
    <div className="mx-6 my-2 flex items-center gap-2 text-meta text-text-secondary" data-work-mode-more>
      <span>{text}</span>
      <button
        type="button"
        onClick={onShow}
        className="rounded-control px-1.5 py-0.5 text-meta font-medium text-accent-blue hover:bg-bg-hover"
      >
        {t('workMode.showMore')}
      </button>
    </div>
  )
}
