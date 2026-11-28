import { useRef, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useSetWorkMode, useWorkMode } from '@/hooks/use-work-mode'
import { announce } from '@/stores/announcer-store'
import { cn } from '@/lib/cn'
import { workModeOptions, type WorkMode } from '../../../shared/work-scope'

/** The key a mode is named by, written out so the compiler and the unused-key check read them. */
function useModeText() {
  const { t } = useTranslation()
  return {
    label: (mode: WorkMode) => (mode === 'work' ? t('workMode.work') : mode === 'personal' ? t('workMode.personal') : t('workMode.all')),
    announcement: (mode: WorkMode) =>
      mode === 'work' ? t('workMode.announceWork') : mode === 'personal' ? t('workMode.announcePersonal') : t('workMode.announceAll'),
  }
}

/**
 * Personal, Work and (optionally) All (cross-app semantics 22.4) at the top of the sidebar, while
 * the feature is on. A radio group: Left and Right (and Up and Down) move the choice, Home and End
 * jump. The chosen segment is told by its weight and its outline as well as its fill, and by the
 * system's highlight colours when colours are forced.
 */
export function WorkModeSwitch() {
  const { enabled, mode, showAll } = useWorkMode()
  const setMode = useSetWorkMode()
  const text = useModeText()
  const { t } = useTranslation()
  const refs = useRef<Partial<Record<WorkMode, HTMLButtonElement | null>>>({})
  if (!enabled) return null

  const options = workModeOptions(showAll)

  const choose = (next: WorkMode, focus = false) => {
    if (next !== mode) {
      setMode(next)
      announce(text.announcement(next))
    }
    if (focus) refs.current[next]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let target: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') target = (index + 1) % options.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') target = (index + options.length - 1) % options.length
    else if (event.key === 'Home') target = 0
    else if (event.key === 'End') target = options.length - 1
    if (target === null) return
    event.preventDefault()
    choose(options[target], true)
  }

  return (
    <div className="px-2 pt-2" data-work-mode-switch>
      <div role="radiogroup" aria-label={t('workMode.switchLabel')} className="flex w-full min-w-0 gap-0.5 rounded-control bg-bg-hover p-0.5">
        {options.map((entry, index) => {
          const selected = entry === mode
          return (
            <button
              key={entry}
              ref={(element) => {
                refs.current[entry] = element
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              data-work-mode={entry}
              onClick={() => choose(entry)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                'min-w-0 flex-1 truncate rounded-control border px-0 py-1 text-center text-caption transition-colors duration-fade-fast',
                selected
                  ? 'border-border bg-bg-page font-semibold text-text shadow-sm forced-colors:border-[Highlight] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText] forced-colors:[forced-color-adjust:none]'
                  : 'border-transparent font-medium text-text-secondary hover:text-text',
              )}
            >
              {text.label(entry)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
