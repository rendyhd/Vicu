import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Folder, Gauge, GripVertical, ListFilter, Tag } from 'lucide-react'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Checkbox } from '@/components/shared/Checkbox'
import { SmartListIcon } from '@/components/shared/SmartListIcon'
import { useSidebarArrangement } from '@/hooks/use-sidebar-layout'
import { announce } from '@/stores/announcer-store'
import { cn } from '@/lib/cn'
import {
  SIDEBAR_HIDEABLE_LISTS,
  isHiddenFromSidebar,
  withSidebarListHidden,
  type AppConfig,
  type SidebarHideableList,
} from '@/lib/vikunja-types'
import { isSidebarBlock, movedEntry, type SidebarEntry } from '../../../shared/sidebar-layout'

interface SidebarSettingsProps {
  config: AppConfig
  onChange: (partial: Partial<AppConfig>) => void
}

const isHideable = (id: string): id is SidebarHideableList => (SIDEBAR_HIDEABLE_LISTS as readonly string[]).includes(id)

/**
 * Settings → General → Sidebar: one list of the smart lists that are on and the sidebar's blocks
 * (Pro's section while Pro is on, the projects, the custom lists, the labels), dragged into the
 * person's order (`sidebar_order`, rules in `src/shared/sidebar-layout.ts`; the phone's drawer has
 * the same). A smart list has a checkbox that shows it; the Inbox always stays, and a hidden list
 * keeps working. The lists under the last block stay in view at the bottom of the sidebar.
 */
export function SidebarSettings({ config, onChange }: SidebarSettingsProps) {
  const { t } = useTranslation()
  const { entries, lists, isDefault, arrange, reset } = useSidebarArrangement()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  // The button to focus again once a keyboard move has drawn the row in its new place.
  const refocus = useRef<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!refocus.current) return
    const selector = `[data-sidebar-move="${refocus.current}"]`
    refocus.current = null
    const button = listRef.current?.querySelector<HTMLButtonElement>(selector)
    // A row moved to the first or last place has lost that button: the other one takes the focus.
    ;(button ?? listRef.current?.querySelector<HTMLButtonElement>(selector.replace(/:(up|down)"/, (_, way) => `:${way === 'up' ? 'down' : 'up'}"`)))?.focus()
  })

  const nameOf = (entry: SidebarEntry): string => {
    if (entry === 'projects') return t('settings.sidebar.projects')
    if (entry === 'lists') return t('settings.sidebar.lists')
    if (entry === 'labels') return t('settings.sidebar.labels')
    // i18n-ignore: a product name
    if (entry === 'pro') return 'Pro'
    return lists.get(entry)?.label ?? entry
  }

  const iconOf = (entry: SidebarEntry): ReactNode => {
    const className = 'h-4 w-4 shrink-0 text-text-secondary'
    if (entry === 'projects') return <Folder aria-hidden="true" className={className} strokeWidth={1.8} />
    if (entry === 'lists') return <ListFilter aria-hidden="true" className={className} strokeWidth={1.8} />
    if (entry === 'labels') return <Tag aria-hidden="true" className={className} strokeWidth={1.8} />
    if (entry === 'pro') return <Gauge aria-hidden="true" className={className} strokeWidth={1.8} />
    return <SmartListIcon list={entry} className="h-4 w-4" />
  }

  const shown = (entry: SidebarEntry) => isSidebarBlock(entry) || !isHiddenFromSidebar(config, entry)
  // The lists under the last block are the ones the sidebar keeps in view at the bottom.
  const lastBlock = entries.reduce((last, entry, index) => (isSidebarBlock(entry) ? index : last), -1)

  const move = (from: number, to: number, focus?: 'up' | 'down') => {
    const next = movedEntry(entries, from, to)
    if (next.every((entry, index) => entry === entries[index])) return
    if (focus) refocus.current = `${entries[from]}:${focus}`
    arrange(next)
    announce(t('settings.sidebar.moved', { name: nameOf(entries[from]), place: to + 1, total: entries.length }))
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    move(entries.indexOf(active.id as SidebarEntry), entries.indexOf(over.id as SidebarEntry))
  }

  return (
    <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">{t('settings.sidebar.title')}</h2>
      <p className="mb-4 text-xs text-[var(--text-secondary)]">
        {t('settings.sidebar.arrange')}
      </p>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <SortableContext items={entries} strategy={verticalListSortingStrategy}>
          <div ref={listRef} className="-mx-2 flex flex-col gap-0.5" data-sidebar-arrange>
            {entries.map((entry, index) => (
              <ArrangeRow
                key={entry}
                entry={entry}
                name={nameOf(entry)}
                icon={iconOf(entry)}
                checked={isHideable(entry) ? shown(entry) : null}
                onCheck={(checked) => {
                  if (isHideable(entry)) onChange({ sidebar_hidden_lists: withSidebarListHidden(config, entry, !checked) })
                }}
                note={index > lastBlock && lastBlock >= 0 && shown(entry) ? t('settings.sidebar.pinned') : null}
                onMoveUp={index > 0 ? () => move(index, index - 1, 'up') : null}
                onMoveDown={index < entries.length - 1 ? () => move(index, index + 1, 'down') : null}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {!isDefault && (
        <button
          type="button"
          onClick={reset}
          className="mt-3 rounded-control px-2 py-1 text-xs font-medium text-accent-blue hover:bg-bg-hover"
        >
          {t('settings.sidebar.reset')}
        </button>
      )}
    </div>
  )
}

interface ArrangeRowProps {
  entry: SidebarEntry
  name: string
  icon: ReactNode
  /** Whether the sidebar shows it; null for what cannot be hidden (the Inbox and the blocks). */
  checked: boolean | null
  onCheck: (checked: boolean) => void
  note: string | null
  onMoveUp: (() => void) | null
  onMoveDown: (() => void) | null
}

/** One smart list or block: a grip to drag it by, its checkbox and name, and Move up and Move down. */
function ArrangeRow({ entry, name, icon, checked, onCheck, note, onMoveUp, onMoveDown }: ArrangeRowProps) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: entry })
  const noteId = useId()
  const moveClass = 'flex h-6 w-6 items-center justify-center rounded-control text-text-secondary hover:bg-bg-selected hover:text-text'
  const content = (
    <>
      {icon}
      <span className="min-w-0 truncate text-sm text-[var(--text-primary)]">{name}</span>
    </>
  )

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-sidebar-entry={entry}
      className={cn('group/arrange relative flex h-9 items-center gap-2 rounded-control px-2 hover:bg-bg-hover', isDragging && 'vicu-lift z-10 bg-bg-hover')}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        // The keyboard's way is Move up and Move down at the end of the row.
        tabIndex={-1}
        aria-hidden="true"
        className="flex h-6 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-text-secondary active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {checked === null ? (
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
          {content}
        </div>
      ) : (
        <label className="flex min-w-0 cursor-pointer items-center gap-2">
          <Checkbox checked={checked} aria-describedby={note ? noteId : undefined} onChange={(e) => onCheck(e.target.checked)} />
          {content}
        </label>
      )}
      {/* Beside the label, not in it: the note is not part of the checkbox's name. */}
      <span id={noteId} className="min-w-0 flex-1 truncate text-caption font-medium text-text-secondary">{note}</span>
      {onMoveUp && (
        <button type="button" data-sidebar-move={`${entry}:up`} aria-label={t('settings.sidebar.moveUp', { name })} onClick={onMoveUp} className={moveClass}>
          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      {onMoveDown ? (
        <button type="button" data-sidebar-move={`${entry}:down`} aria-label={t('settings.sidebar.moveDown', { name })} onClick={onMoveDown} className={moveClass}>
          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : (
        <span aria-hidden="true" className="h-6 w-6 shrink-0" />
      )}
    </div>
  )
}
