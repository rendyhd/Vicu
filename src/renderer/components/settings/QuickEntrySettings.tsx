import { Checkbox } from '@/components/shared/Checkbox'
import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { HotkeyRecorder } from './HotkeyRecorder'
import { useCustomLists } from '@/hooks/use-custom-lists'
import { isQuickEntryEnabled, isQuickViewEnabled, type AppConfig, type Project, type ViewerFilter } from '@/lib/vikunja-types'

interface QuickEntrySettingsProps {
  config: AppConfig
  projects: Project[]
  onChange: (partial: Partial<AppConfig>) => void
  hotkeyWarnings?: { entry: boolean; viewer: boolean; waylandLimited: boolean }
}

/** Key names are the same in every language. */
function modifierLabel(mod: 'ctrl' | 'alt' | 'ctrl+alt'): string {
  const mac = window.api.platform === 'darwin'
  // i18n-ignore: keyboard key names
  if (mod === 'ctrl') return mac ? '⌘ Cmd' : 'Ctrl'
  // i18n-ignore: keyboard key names
  if (mod === 'alt') return mac ? '⌥ Option' : 'Alt'
  // i18n-ignore: keyboard key names
  return mac ? '⌘⌥ Cmd+Option' : 'Ctrl+Alt'
}

export function QuickEntrySettings({ config, projects, onChange, hotkeyWarnings }: QuickEntrySettingsProps) {
  const { t } = useTranslation()
  const { data: customLists = [] } = useCustomLists()
  const hotkeyFailureCopy = window.api.platform === 'linux'
    ? t('settings.quickEntry.hotkeyFailure.linux')
    : t('settings.quickEntry.hotkeyFailure.other')
  const [launcherCmd, setLauncherCmd] = useState<{ quickEntry: string; quickView: string; kind: 'appimage' | 'packaged' | 'dev' } | null>(null)
  const [copied, setCopied] = useState<'entry' | 'view' | null>(null)

  // Fetch the launcher command once on mount on Linux. Done unconditionally
  // (not gated on hotkeyWarnings) so it's always ready by the time the
  // Wayland warning renders, and so a slow or missed warning state doesn't
  // leave the banner showing instructions with no copyable command.
  useEffect(() => {
    if (window.api.platform !== 'linux') return
    api.getHotkeyLauncherCommand().then(setLauncherCmd).catch((err) => {
      console.error('[Settings] getHotkeyLauncherCommand failed:', err)
    })
  }, [])

  const copy = (text: string, which: 'entry' | 'view') => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(which)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  const entryEnabled = isQuickEntryEnabled(config)
  const viewEnabled = isQuickViewEnabled(config)
  const viewerFilter = config.viewer_filter ?? {
    project_ids: [],
    sort_by: 'due_date',
    order_by: 'asc',
    due_date_filter: 'all',
    include_today_all_projects: false,
  }
  const activeProjectIds = new Set(projects.map((project) => project.id))
  const configuredDefaultProjectId = config.quick_entry_default_project_id || config.inbox_project_id || 0
  const defaultProjectAvailable = configuredDefaultProjectId === 0 || activeProjectIds.has(configuredDefaultProjectId)
  const configuredSecondaryProjects = config.secondary_projects || []
  const availableSecondaryProjects = configuredSecondaryProjects.filter((project) => activeProjectIds.has(project.id))
  const unavailableSecondaryProjectCount = configuredSecondaryProjects.length - availableSecondaryProjects.length
  const configuredViewerProjectId =
    !viewerFilter.view_type && !viewerFilter.custom_list_id
      ? (viewerFilter.project_ids || [])[0] || 0
      : 0
  const viewerProjectAvailable = configuredViewerProjectId === 0 || activeProjectIds.has(configuredViewerProjectId)

  const updateViewerFilter = (partial: Partial<ViewerFilter>) => {
    onChange({ viewer_filter: { ...viewerFilter, ...partial } })
  }

  const addSecondaryProject = (projectId: number) => {
    const existing = config.secondary_projects || []
    if (existing.some((p) => p.id === projectId)) return
    const project = projects.find((p) => p.id === projectId)
    if (!project) return
    onChange({
      secondary_projects: [...existing, { id: project.id, title: project.title }],
    })
  }

  const removeSecondaryProject = (projectId: number) => {
    const existing = config.secondary_projects || []
    onChange({
      secondary_projects: existing.filter((p) => p.id !== projectId),
    })
  }

  return (
    <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('settings.quickEntry.title')}</h2>

      <div className="mt-4 space-y-4">
        {hotkeyWarnings?.waylandLimited && (entryEnabled || viewEnabled) && (
          <div className="rounded-control border border-status-today/40 bg-status-today/10 px-3 py-3 text-xs text-[var(--text-primary)]">
            <p className="mb-2 font-semibold text-status-today">
              {t('settings.quickEntry.wayland.title')}
            </p>
            <p className="mb-2 text-[var(--text-secondary)]">
              {t('settings.quickEntry.wayland.intro')}
            </p>
            <ol className="mb-3 list-decimal space-y-1 pl-5 text-[var(--text-secondary)]">
              <li><Trans i18nKey="settings.quickEntry.wayland.step1" components={{ gnome: <strong className="text-[var(--text-primary)]" />, kde: <strong className="text-[var(--text-primary)]" /> }} /></li>
              <li><Trans i18nKey="settings.quickEntry.wayland.step2" components={{ field: <em /> }} /></li>
              <li><Trans i18nKey="settings.quickEntry.wayland.step3" components={{ combo: <code className="rounded-control bg-[var(--bg-tertiary)] px-1" /> }} /></li>
              <li>{t('settings.quickEntry.wayland.step4')}</li>
            </ol>
            {!launcherCmd && (
              <div className="text-[var(--text-secondary)]">{t('settings.quickEntry.wayland.loading')}</div>
            )}
            {launcherCmd?.kind === 'dev' && (
              <div className="mb-2 rounded-control border border-yellow-500/40 bg-yellow-500/10 px-2 py-1.5 text-[11px] text-yellow-600 dark:text-yellow-400">
                <Trans i18nKey="settings.quickEntry.wayland.devNotice" components={{ notice: <strong /> }} />
              </div>
            )}
            {launcherCmd && (
              <div className="space-y-2">
                {entryEnabled && (
                  <div>
                    <div className="mb-1 text-[var(--text-secondary)]">{t('settings.quickEntry.wayland.entryCommand')}</div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-control border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)]">
                        {launcherCmd.quickEntry}
                      </code>
                      <button
                        type="button"
                        onClick={() => copy(launcherCmd.quickEntry, 'entry')}
                        className="shrink-0 rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                      >
                        {copied === 'entry' ? t('settings.quickEntry.wayland.copied') : t('settings.quickEntry.wayland.copy')}
                      </button>
                    </div>
                  </div>
                )}
                {viewEnabled && (
                  <div>
                    <div className="mb-1 text-[var(--text-secondary)]">{t('settings.quickEntry.wayland.viewCommand')}</div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-control border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)]">
                        {launcherCmd.quickView}
                      </code>
                      <button
                        type="button"
                        onClick={() => copy(launcherCmd.quickView, 'view')}
                        className="shrink-0 rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                      >
                        {copied === 'view' ? t('settings.quickEntry.wayland.copied') : t('settings.quickEntry.wayland.copy')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {/* Enable toggles */}
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={entryEnabled}
              onChange={(e) => onChange({ quick_entry_enabled: e.target.checked })}
            />
            <span className="text-sm text-[var(--text-primary)]">
              {t('settings.quickEntry.enableEntry')}
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={viewEnabled}
              onChange={(e) => onChange({ quick_view_enabled: e.target.checked })}
            />
            <span className="text-sm text-[var(--text-primary)]">
              {t('settings.quickEntry.enableView')}
            </span>
          </label>
        </div>

        {entryEnabled && (
            <>
              {/* Quick Entry section */}
              <div className="space-y-3 border-t border-[var(--border-color)] pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  {t('settings.quickEntry.entry.title')}
                </h3>

                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">{t('settings.quickEntry.hotkey')}</label>
                  <HotkeyRecorder
                    value={config.quick_entry_hotkey || 'Alt+Shift+V'}
                    onChange={(v) => onChange({ quick_entry_hotkey: v })}
                    defaultValue="Alt+Shift+V"
                    label={t('settings.quickEntry.entry.hotkeyLabel')}
                    warning={hotkeyWarnings?.entry === false}
                  />
                  {hotkeyWarnings?.entry === false && (
                    <p className="mt-1 text-xs text-status-today">
                      {hotkeyFailureCopy}
                    </p>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">{t('settings.quickEntry.entry.defaultProject.label')}</label>
                  <select
                    aria-label={t('settings.quickEntry.entry.defaultProject.aria')}
                    value={defaultProjectAvailable ? configuredDefaultProjectId : 0}
                    onChange={(e) => onChange({ quick_entry_default_project_id: Number(e.target.value) })}
                    className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  >
                    <option value={0}>{t('settings.quickEntry.entry.defaultProject.placeholder')}</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                  </select>
                  {!defaultProjectAvailable && (
                    <p className="mt-1 text-xs text-status-today">
                      {t('settings.quickEntry.entry.defaultProject.archived')}
                    </p>
                  )}
                </div>

                {/* Secondary projects */}
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">
                    {t('settings.quickEntry.entry.secondary.label')}
                  </label>
                  <div className="space-y-1">
                    {availableSecondaryProjects.map((sp) => (
                      <div key={sp.id} className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                        <span className="flex-1">{sp.title}</span>
                        <button
                          type="button"
                          onClick={() => removeSecondaryProject(sp.id)}
                          className="text-xs text-danger hover:text-danger/80"
                        >
                          {t('settings.quickEntry.entry.secondary.remove')}
                        </button>
                      </div>
                    ))}
                    {unavailableSecondaryProjectCount > 0 && (
                      <p className="text-xs text-status-today">
                        {t('settings.quickEntry.entry.secondary.archivedHidden', { count: unavailableSecondaryProjectCount })}
                      </p>
                    )}
                    <select
                      aria-label={t('settings.quickEntry.entry.secondary.addAria')}
                      value=""
                      onChange={(e) => {
                        if (e.target.value) addSecondaryProject(Number(e.target.value))
                        e.target.value = ''
                      }}
                      className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"
                    >
                      <option value="">{t('settings.quickEntry.entry.secondary.addPlaceholder')}</option>
                      {projects
                        .filter((p) => !(config.secondary_projects || []).some((sp) => sp.id === p.id))
                        .map((p) => (
                          <option key={p.id} value={p.id}>{p.title}</option>
                        ))}
                    </select>
                  </div>
                </div>

                {/* Project cycle modifier */}
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">
                    {t('settings.quickEntry.entry.modifier.label')}
                  </label>
                  <div className="flex gap-2">
                    {(['ctrl', 'alt', 'ctrl+alt'] as const).map((mod) => (
                      <label
                        key={mod}
                        className={cn(
                          'flex cursor-pointer items-center gap-1.5 rounded-control border px-3 py-1.5 text-xs font-medium transition-colors',
                          config.project_cycle_modifier === mod
                            ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                            : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)]'
                        )}
                      >
                        <input
                          type="radio"
                          name="project-cycle-modifier"
                          value={mod}
                          checked={config.project_cycle_modifier === mod}
                          onChange={() => onChange({ project_cycle_modifier: mod })}
                          className="sr-only"
                        />
                        {/* i18n-ignore: keyboard key names */}
                        {modifierLabel(mod)}
                      </label>
                    ))}
                  </div>
                </div>

              </div>
            </>
          )}

          {viewEnabled && (
            <>
              {/* Quick View section */}
              <div className="space-y-3 border-t border-[var(--border-color)] pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  {t('settings.quickEntry.view.title')}
                </h3>

                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">{t('settings.quickEntry.hotkey')}</label>
                  <HotkeyRecorder
                    value={config.quick_view_hotkey || 'Alt+Shift+B'}
                    onChange={(v) => onChange({ quick_view_hotkey: v })}
                    defaultValue="Alt+Shift+B"
                    label={t('settings.quickEntry.view.hotkeyLabel')}
                    warning={hotkeyWarnings?.viewer === false}
                  />
                  {hotkeyWarnings?.viewer === false && (
                    <p className="mt-1 text-xs text-status-today">
                      {hotkeyFailureCopy}
                    </p>
                  )}
                </div>

                {/* List picker */}
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">{t('settings.quickEntry.view.list.label')}</label>
                  <select
                    aria-label={t('settings.quickEntry.view.list.aria')}
                    value={
                      viewerFilter.view_type
                        ? `view:${viewerFilter.view_type}`
                        : viewerFilter.custom_list_id || String(viewerProjectAvailable ? configuredViewerProjectId : 0)
                    }
                    onChange={(e) => {
                      const val = e.target.value
                      if (val.startsWith('view:')) {
                        const vt = val.slice(5) as 'today' | 'upcoming' | 'anytime'
                        updateViewerFilter({ view_type: vt, custom_list_id: undefined, project_ids: [] })
                      } else {
                        if (customLists.some((l) => l.id === val)) {
                          updateViewerFilter({ view_type: undefined, custom_list_id: val, project_ids: [] })
                        } else {
                          const id = Number(val)
                          updateViewerFilter({ view_type: undefined, custom_list_id: undefined, project_ids: id ? [id] : [] })
                        }
                      }
                    }}
                    className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  >
                    <option value="0">{t('settings.quickEntry.view.list.allProjects')}</option>
                    <optgroup label={t('settings.quickEntry.view.list.views')}>
                      <option value="view:today">{t('settings.quickEntry.view.list.today')}</option>
                      <option value="view:upcoming">{t('settings.quickEntry.view.list.upcoming')}</option>
                      <option value="view:anytime">{t('settings.quickEntry.view.list.anytime')}</option>
                    </optgroup>
                    <optgroup label={t('settings.quickEntry.view.list.projects')}>
                      {projects.map((p) => (
                        <option key={p.id} value={String(p.id)}>{p.title}</option>
                      ))}
                    </optgroup>
                    {customLists.length > 0 && (
                      <optgroup label={t('settings.quickEntry.view.list.lists')}>
                        {customLists.map((l) => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {!viewerProjectAvailable && (
                    <p className="mt-1 text-xs text-status-today">
                      {t('settings.quickEntry.view.list.archived')}
                    </p>
                  )}
                </div>

                {/* Include today from all projects */}
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={viewerFilter.include_today_all_projects ?? false}
                    onChange={(e) => updateViewerFilter({ include_today_all_projects: e.target.checked })}
                  />
                  <span className="text-sm text-[var(--text-primary)]">
                    {t('settings.quickEntry.view.includeToday')}
                  </span>
                </label>
              </div>
            </>
          )}

        </div>
    </div>
  )
}
