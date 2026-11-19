import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../../shared/i18n'
import { can } from '@/lib/capabilities'
import { hasModT, newEventShortcut, newTaskShortcut } from '@/lib/host-shortcuts'

const isMac = window.api.platform === 'darwin'
const mod = isMac ? '\u2318' : 'Ctrl'
/** A spec such as "Mod+Shift+N" as the keys of a row. */
const keysOf = (spec: string): string[] => spec.split('+').map((part) => (part === 'Mod' ? mod : part))

const shortcuts: { category: TranslationKey; items: { keys: string[]; description: TranslationKey }[] }[] = [
  { category: 'settings.shortcuts.categories.navigation', items: [
    { keys: ['Up'], description: 'settings.shortcuts.items.previousTask' },
    { keys: ['Down'], description: 'settings.shortcuts.items.nextTask' },
    { keys: ['Enter'], description: 'settings.shortcuts.items.openTask' },
    { keys: ['Escape'], description: 'settings.shortcuts.items.collapseTask' },
  ]},
  { category: 'settings.shortcuts.categories.taskActions', items: [
    { keys: keysOf(newTaskShortcut()), description: 'settings.shortcuts.items.newTask' },
    { keys: [mod, 'V'], description: 'settings.shortcuts.items.newTaskFromClipboard' },
    { keys: [mod, 'Enter'], description: 'settings.shortcuts.items.saveAndClose' },
    { keys: [mod, 'K'], description: 'settings.shortcuts.items.completeSelected' },
    { keys: [mod, 'D'], description: 'settings.shortcuts.items.duplicateSelected' },
    { keys: [mod, 'C'], description: 'settings.shortcuts.items.copyTitles' },
  ]},
  { category: 'settings.shortcuts.categories.scheduling', items: [
    ...(hasModT() ? [{ keys: [mod, 'T'], description: 'settings.shortcuts.items.dueToday' as const }] : []),
    { keys: ['!'], description: 'settings.shortcuts.items.dueToday' },
  ]},
  { category: 'settings.shortcuts.categories.plan', items: [
    { keys: keysOf(newEventShortcut()), description: 'settings.shortcuts.items.newEvent' },
    { keys: ['Alt', 'Shift', 'Up'], description: 'settings.shortcuts.items.moveEarlier' },
    { keys: ['Alt', 'Shift', 'Down'], description: 'settings.shortcuts.items.moveLater' },
    { keys: ['Shift', 'Up'], description: 'settings.shortcuts.items.shorter' },
    { keys: ['Shift', 'Down'], description: 'settings.shortcuts.items.longer' },
  ]},
  { category: 'settings.shortcuts.categories.editing', items: [
    { keys: ['Enter'], description: 'settings.shortcuts.items.focusNotes' },
    { keys: ['Escape'], description: 'settings.shortcuts.items.saveAndClose' },
    { keys: [mod, 'Enter'], description: 'settings.shortcuts.items.saveAndClose' },
    { keys: [mod, 'K'], description: 'settings.shortcuts.items.completeAndClose' },
    ...(hasModT() ? [{ keys: [mod, 'T'], description: 'settings.shortcuts.items.dueToday' as const }] : []),
    { keys: [mod, 'Shift', 'C'], description: 'settings.shortcuts.items.toggleComments' },
  ]},
  { category: 'settings.shortcuts.categories.assistant', items: [
    { keys: [mod, 'J'], description: 'settings.shortcuts.items.toggleAsk' },
    { keys: ['Enter'], description: 'settings.shortcuts.items.sendMessage' },
    { keys: [mod, 'Enter'], description: 'settings.shortcuts.items.makeTasks' },
  ]},
  { category: 'settings.shortcuts.categories.pro', items: [
    { keys: [mod, 'Shift', 'O'], description: 'settings.shortcuts.items.focusProjects' },
    { keys: [mod, 'Shift', 'F'], description: 'settings.shortcuts.items.flag' },
    { keys: [mod, 'Shift', 'M'], description: 'settings.shortcuts.items.importMeeting' },
    { keys: [mod, 'I'], description: 'settings.shortcuts.items.inspector' },
    { keys: ['1', '-', '6'], description: 'settings.shortcuts.items.verdict' },
  ]},
  { category: 'settings.shortcuts.categories.comments', items: [
    { keys: [mod, 'Enter'], description: 'settings.shortcuts.items.postComment' },
    { keys: ['@'], description: 'settings.shortcuts.items.mention' },
    { keys: ['Escape'], description: 'settings.shortcuts.items.closeComments' },
  ]},
]

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-1.5 text-caption font-medium text-[var(--text-secondary)]">
      {children}
    </kbd>
  )
}

export function KeyboardShortcuts() {
  const { t } = useTranslation()
  return (
    <div className="space-y-6">
      {shortcuts.filter((section) => can('assistant') || section.category !== 'settings.shortcuts.categories.assistant').map((section) => (
        <div
          key={t(section.category)}
          className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5"
        >
          <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
            {t(section.category)}
          </h2>
          <div className="space-y-2">
            {section.items.map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-1"
              >
                <span className="text-xs text-[var(--text-secondary)]">
                  {t(item.description)}
                </span>
                <div className="flex items-center gap-1">
                  {item.keys.map((key, j) => (
                    <span key={j} className="flex items-center gap-0.5">
                      {j > 0 && (
                        <span className="text-caption text-[var(--text-secondary)]">+</span>
                      )}
                      <Kbd>{key}</Kbd>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
