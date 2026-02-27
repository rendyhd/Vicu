import { cn } from '@/lib/cn'
import { HotkeyRecorder } from './HotkeyRecorder'
import type { AppConfig, Project, SecondaryProject, ViewerFilter } from '@/lib/vikunja-types'

interface QuickEntrySettingsProps {
  config: AppConfig
  projects: Project[]
  onChange: (partial: Partial<AppConfig>) => void
  hotkeyWarnings?: { entry: boolean; viewer: boolean }
}


export function QuickEntrySettings({ config, projects, onChange, hotkeyWarnings }: QuickEntrySettingsProps) {
  const entryEnabled = config.quick_entry_enabled ?? false
  const viewEnabled = config.quick_view_enabled === true
  const viewerFilter = config.viewer_filter ?? {
    project_ids: [],
    sort_by: 'due_date',
    order_by: 'asc',
    due_date_filter: 'all',
    include_today_all_projects: false,
  }

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
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">Quick Entry & Quick View</h2>

      <div className="mt-4 space-y-4">
        {/* Enable toggles */}
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={entryEnabled}
              onChange={(e) => onChange({ quick_entry_enabled: e.target.checked })}
              className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
            />
            <span className="text-sm text-[var(--text-primary)]">
              Enable Quick Entry
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={viewEnabled}
              onChange={(e) => onChange({ quick_view_enabled: e.target.checked })}
              className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
            />
            <span className="text-sm text-[var(--text-primary)]">
              Enable Quick View
            </span>
          </label>
        </div>

        {entryEnabled && (
            <>
              {/* Quick Entry section */}
              <div className="space-y-3 border-t border-[var(--border-color)] pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Quick Entry
                </h3>

                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">Hotkey</label>
                  <HotkeyRecorder
                    value={config.quick_entry_hotkey || 'Alt+Shift+V'}
                    onChange={(v) => onChange({ quick_entry_hotkey: v })}
                    defaultValue="Alt+Shift+V"
                    warning={hotkeyWarnings?.entry === false}
                  />
                  {hotkeyWarnings?.entry === false && (
                    <p className="mt-1 text-xs text-accent-orange">
                      Failed to register — hotkey may be in use by another application
                    </p>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">Default Project</label>
                  <select
                    value={config.quick_entry_default_project_id || config.inbox_project_id || 0}
                    onChange={(e) => onChange({ quick_entry_default_project_id: Number(e.target.value) })}
                    className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-accent-blue focus:outline-none"
                  >
                    <option value={0}>Select a project...</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                  </select>
                </div>

                {/* Secondary projects */}
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">
                    Secondary Projects (cycle with modifier + arrow keys)
                  </label>
                  <div className="space-y-1">
                    {(config.secondary_projects || []).map((sp) => (
                      <div key={sp.id} className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                        <span className="flex-1">{sp.title}</span>
                        <button
                          type="button"
                          onClick={() => removeSecondaryProject(sp.id)}
                          className="text-xs text-accent-red hover:text-accent-red/80"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) addSecondaryProject(Number(e.target.value))
                        e.target.value = ''
                      }}
                      className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs text-[var(--text-secondary)] focus:border-accent-blue focus:outline-none"
                    >
                      <option value="">Add a project...</option>
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
                    Project Cycle Modifier
                  </label>
                  <div className="flex gap-2">
                    {(['ctrl', 'alt', 'ctrl+alt'] as const).map((mod) => (
                      <label
                        key={mod}
                        className={cn(
                          'flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
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
                        {mod === 'ctrl'
                          ? (window.api.platform === 'darwin' ? '\u2318 Cmd' : 'Ctrl')
                          : mod === 'alt'
                            ? (window.api.platform === 'darwin' ? '\u2325 Option' : 'Alt')
                            : (window.api.platform === 'darwin' ? '\u2318\u2325 Cmd+Option' : 'Ctrl+Alt')}
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
                  Quick View
                </h3>

                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">Hotkey</label>
                  <HotkeyRecorder
                    value={config.quick_view_hotkey || 'Alt+Shift+B'}
                    onChange={(v) => onChange({ quick_view_hotkey: v })}
                    defaultValue="Alt+Shift+B"
                    warning={hotkeyWarnings?.viewer === false}
                  />
                  {hotkeyWarnings?.viewer === false && (
                    <p className="mt-1 text-xs text-accent-orange">
                      Failed to register — hotkey may be in use by another application
                    </p>
                  )}
                </div>

                {/* List picker */}
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">List</label>
                  <select
                    value={
                      viewerFilter.view_type
                        ? `view:${viewerFilter.view_type}`
                        : viewerFilter.custom_list_id || String((viewerFilter.project_ids || [])[0] || 0)
                    }
                    onChange={(e) => {
                      const val = e.target.value
                      if (val.startsWith('view:')) {
                        const vt = val.slice(5) as 'today' | 'upcoming' | 'anytime'
                        updateViewerFilter({ view_type: vt, custom_list_id: undefined, project_ids: [] })
                      } else {
                        const customLists = config.custom_lists || []
                        if (customLists.some((l) => l.id === val)) {
                          updateViewerFilter({ view_type: undefined, custom_list_id: val, project_ids: [] })
                        } else {
                          const id = Number(val)
                          updateViewerFilter({ view_type: undefined, custom_list_id: undefined, project_ids: id ? [id] : [] })
                        }
                      }
                    }}
                    className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-accent-blue focus:outline-none"
                  >
                    <option value="0">All projects</option>
                    <optgroup label="Views">
                      <option value="view:today">Today</option>
                      <option value="view:upcoming">Upcoming</option>
                      <option value="view:anytime">Anytime</option>
                    </optgroup>
                    <optgroup label="Projects">
                      {projects.map((p) => (
                        <option key={p.id} value={String(p.id)}>{p.title}</option>
                      ))}
                    </optgroup>
                    {(config.custom_lists || []).length > 0 && (
                      <optgroup label="Lists">
                        {(config.custom_lists || []).map((l) => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                {/* Include today from all projects */}
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={viewerFilter.include_today_all_projects ?? false}
                    onChange={(e) => updateViewerFilter({ include_today_all_projects: e.target.checked })}
                    className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
                  />
                  <span className="text-sm text-[var(--text-primary)]">
                    Include tasks due today from all projects
                  </span>
                </label>
              </div>
            </>
          )}

        </div>
    </div>
  )
}
