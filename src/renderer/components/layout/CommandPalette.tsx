import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, CheckCircle2, Circle, Folder, Layers, Mic, Plus, RefreshCw, Settings, Sparkles, SunMoon, Tag } from 'lucide-react'
import { useAppConfig } from '@/hooks/use-app-config'
import { formatAcceleratorForDisplay } from '@/lib/accelerator'
import { Dialog } from '@/components/overlay/Dialog'
import { nextOptionIndex } from '@/components/overlay/popover-logic'
import { useSmartLists } from '@/components/sidebar/SmartListNav'
import { useProNavItems } from '@/components/sidebar/ProNav'
import { usePro } from '@/hooks/use-pro'
import { useProUiStore } from '@/stores/pro-ui-store'
import { SmartListIcon } from '@/components/shared/SmartListIcon'
import type { SmartListId } from '@/lib/smart-list-identity'
import { useQuickFindTasks } from '@/hooks/use-quick-find'
import { useOpenTask } from '@/hooks/use-open-task'
import { useProjects } from '@/hooks/use-projects'
import { useLabels } from '@/hooks/use-labels'
import { useIsDark } from '@/hooks/use-is-dark'
import { refreshNow } from '@/hooks/use-manual-refresh'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { applyTheme } from '@/lib/theme'
import { useAskStore } from '@/stores/ask-store'
import { useAiUiStore } from '@/stores/ai-ui-store'
import { useDictationStore } from '@/stores/dictation-store'
import { toast } from '@/stores/toast-store'
import { useAiReady } from '@/hooks/use-ai'
import { buildPaletteItems, rankPalette, type PaletteCommand, type PaletteItem, type PaletteKind } from '@/lib/palette'
import { shortcutHint } from '@/lib/shortcut-hint'
import { useUIStore } from '@/stores/ui-store'
import { useNewTaskRequestStore } from '@/stores/new-task-request-store'
import { useNewEventRequestStore } from '@/stores/new-event-request-store'
import { isPlannerEnabled } from '@/lib/vikunja-types'
import { useVoiceStore } from '@/stores/voice-store'

const ICONS: Record<PaletteKind, typeof Circle> = {
  Action: Plus,
  List: Circle,
  Guided: Layers,
  Project: Folder,
  Label: Tag,
  Task: Circle,
}

/**
 * The command palette (Ctrl+Shift+P, Command+Shift+P): one field that finds tasks, projects,
 * labels and smart lists and runs the few actions (New task, Toggle theme, Settings). Matching is
 * fuzzy. Arrow keys move through the list, Enter runs the highlighted entry, Escape closes it and
 * focus returns to where it was. It sits on the modal Dialog.
 */
export function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen)
  const toggle = useUIStore((s) => s.toggleCommandPalette)

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        toggle()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [toggle])

  return (
    <Dialog open={open} onClose={toggle} label="Command palette" className="mt-[12vh] w-[560px]">
      <PaletteBody onClose={toggle} />
    </Dialog>
  )
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const openTask = useOpenTask()
  const smartLists = useSmartLists()
  const { data: projects } = useProjects()
  const { data: labels } = useLabels()
  const { data: appConfig } = useAppConfig()
  const { tasks } = useQuickFindTasks(query, 20)
  const listId = useId()
  const isDark = useIsDark()
  const ai = useAiReady()
  const pro = usePro()
  const proLists = useProNavItems()

  const items = useMemo(
    () => buildPaletteItems({
      smartLists,
      projects: projects?.flat ?? [],
      labels: labels ?? [],
      planner: isPlannerEnabled(appConfig),
      pro: pro.on ? { lists: proLists, focus: pro.layer('availability'), promises: pro.layer('promises') } : undefined,
    }),
    [smartLists, projects?.flat, labels, appConfig, pro, proLists],
  )
  const shown = useMemo(() => rankPalette(items, query, tasks), [items, query, tasks])
  const activeIndex = shown.length === 0 ? -1 : Math.min(active, shown.length - 1)
  const optionId = (index: number) => `${listId}-${index}`

  useEffect(() => {
    if (activeIndex >= 0) document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' })
    // optionId only depends on listId.
  }, [activeIndex, listId])

  const runCommand = (command: PaletteCommand) => {
    if (command === 'settings') {
      void navigate({ to: '/settings' })
    } else if (command === 'pro-settings') {
      void navigate({ to: '/settings', search: { section: 'pro' } })
    } else if (command === 'pro-focus') {
      useProUiStore.getState().setFocusPickerOpen(true)
    } else if (command === 'pro-import' || command === 'pro-copilot' || command === 'pro-recap') {
      useProUiStore.getState().open(command)
    } else if (command === 'voice') {
      useVoiceStore.getState().begin('command', 'latched')
    } else if (command === 'dictate' || command === 'brain-dump') {
      if (ai.dictation) useDictationStore.getState().startLive(command === 'brain-dump' ? { brainDump: true } : {})
      else toast.info('Smart dictation is off. Turn it on in Settings, Assistant.')
    } else if (command === 'ask') {
      useAskStore.getState().setOpen(true)
    } else if (command === 'make-tasks') {
      useAiUiStore.getState().openMakeTasks()
    } else if (command === 'new-event') {
      // The Plan screen takes it once it is on screen.
      useNewEventRequestStore.getState().request()
      void navigate({ to: '/plan' })
    } else if (command === 'refresh') {
      refreshNow(queryClient)
    } else if (command === 'toggle-theme') {
      const next = isDark ? 'light' : 'dark'
      applyTheme(next)
      useUIStore.getState().setTheme(next)
      void api.saveConfigPatch({ theme: next })
    } else {
      // The composer belongs to the list on screen: ask it. When no list takes the request (a view
      // without a composer), Inbox is where a task lands, and its list takes it once it mounts.
      useNewTaskRequestStore.getState().request()
      setTimeout(() => {
        if (useNewTaskRequestStore.getState().requestedAt !== null) void navigate({ to: '/inbox' })
      }, 80)
    }
  }

  const run = (item: PaletteItem) => {
    const action = item.action
    onClose()
    switch (action.type) {
      case 'path':
        void navigate({ to: action.path })
        break
      case 'project':
        void navigate({ to: '/project/$projectId', params: { projectId: String(action.id) } })
        break
      case 'label':
        void navigate({ to: '/tag/$labelId', params: { labelId: String(action.id) } })
        break
      case 'task':
        openTask(action.task.id)
        break
      case 'command':
        runCommand(action.command)
        break
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (activeIndex >= 0) run(shown[activeIndex])
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = nextOptionIndex(activeIndex, shown.length, event.key)
      if (next !== null) setActive(next)
    }
  }

  const detailOf = ({ action, kind }: PaletteItem): string => {
    if (action.type === 'task') return projects?.all.find((p) => p.id === action.task.project_id)?.title ?? kind
    if (action.type === 'command' && action.command === 'new-task') return shortcutHint('Mod+N', window.api.platform === 'darwin')
    if (action.type === 'command' && action.command === 'new-event') return shortcutHint('Mod+Shift+N', window.api.platform === 'darwin')
    if (action.type === 'command' && action.command === 'refresh') return window.api.platform === 'darwin' ? shortcutHint('Mod+R', true) : 'F5'
    if (action.type === 'command' && action.command === 'voice' && appConfig?.voice_hotkey) return formatAcceleratorForDisplay(appConfig.voice_hotkey, window.api.platform === 'darwin')
    return kind
  }

  const iconOf = ({ action, kind }: PaletteItem): typeof Circle => {
    if (action.type === 'task' && action.task.done) return CheckCircle2
    if (action.type === 'command' && action.command === 'settings') return Settings
    if (action.type === 'command' && action.command === 'toggle-theme') return SunMoon
    if (action.type === 'command' && action.command === 'refresh') return RefreshCw
    if (action.type === 'command' && action.command === 'new-event') return CalendarPlus
    if (action.type === 'command' && action.command === 'voice') return Mic
    if (action.type === 'command' && (action.command === 'ask' || action.command === 'make-tasks' || action.command === 'dictate' || action.command === 'brain-dump')) return Sparkles
    return ICONS[kind]
  }

  return (
    <div>
      <div className="border-b border-[var(--border-color)] p-3">
        <input
          data-autofocus
          type="text"
          role="combobox"
          aria-label="Command palette"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder="Type a task, project, label, list or action"
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          className="h-9 w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
        />
      </div>
      <div id={listId} role="listbox" aria-label="Results" className="max-h-80 overflow-y-auto py-1">
        {shown.map((item, index) => {
          const Icon = iconOf(item)
          return (
            <div
              key={item.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              onMouseMove={() => setActive(index)}
              onClick={() => run(item)}
              className={cn('flex cursor-default items-center gap-3 px-4 py-2 text-sm', index === activeIndex && 'bg-[var(--bg-hover)]')}
            >
              {item.kind === 'List' ? (
                <SmartListIcon list={item.id.slice('list:'.length) as SmartListId} className="h-4 w-4 shrink-0" />
              ) : (
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
              )}
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              <span className="max-w-[40%] shrink-0 truncate text-caption text-[var(--text-secondary)]">{detailOf(item)}</span>
            </div>
          )
        })}
        {shown.length === 0 && <div className="px-4 py-3 text-sm text-[var(--text-secondary)]">Nothing matches</div>}
      </div>
      <div role="status" className="sr-only">{`${shown.length} ${shown.length === 1 ? 'result' : 'results'}`}</div>
    </div>
  )
}
