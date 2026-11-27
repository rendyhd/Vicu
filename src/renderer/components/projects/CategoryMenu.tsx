import type { RefObject } from 'react'
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Menu, MenuItem, MenuSeparator } from '@/components/overlay/Menu'
import { useProjectCategoryActions } from '@/hooks/use-project-categories'
import { projectActions } from '@/stores/project-actions-store'
import type { ProjectCategory } from '../../../shared/project-categories'

export interface CategoryMenuProps {
  category: ProjectCategory
  /** Its place among the categories: Move up and Move down are left out at the ends. */
  index: number
  count: number
  anchorRef?: RefObject<HTMLElement | null>
  anchorPoint?: { x: number; y: number }
  /** Where focus goes when the rename dialog closes (the header it came from). */
  opener?: HTMLElement | null
  onClose: () => void
}

/**
 * A category header's menu (cross-app semantics 13.4), in the sidebar and in Settings: rename,
 * one place up or down, delete. Deleting keeps its projects, without a category, and offers Undo.
 */
export function CategoryMenu({ category, index, count, anchorRef, anchorPoint, opener = null, onClose }: CategoryMenuProps) {
  const { t } = useTranslation()
  const actions = useProjectCategoryActions()
  return (
    <Menu anchorRef={anchorRef} anchorPoint={anchorPoint} label={t('projects.category.actions', { name: category.name })} onClose={onClose}>
      <MenuItem
        icon={<Pencil />}
        onSelect={() => projectActions.openDialog({ kind: 'category-rename', categoryId: category.id, name: category.name }, opener)}
      >
        {t('projects.category.rename')}
      </MenuItem>
      {index > 0 && (
        <MenuItem icon={<ArrowUp />} onSelect={() => actions.moveBy(category.id, -1)}>
          {t('projects.category.moveUp')}
        </MenuItem>
      )}
      {index < count - 1 && (
        <MenuItem icon={<ArrowDown />} onSelect={() => actions.moveBy(category.id, 1)}>
          {t('projects.category.moveDown')}
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem icon={<Trash2 />} danger onSelect={() => void actions.remove(category.id)}>
        {t('projects.category.delete')}
      </MenuItem>
    </Menu>
  )
}
