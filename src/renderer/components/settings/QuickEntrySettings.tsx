import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { HotkeyRecorder } from './HotkeyRecorder'
import type { AppConfig, Project, SecondaryProject, ViewerFilter } from '@/lib/vikunja-types'

interface QuickEntrySettingsProps {
  config: AppConfig
  projects: Project[]
  onChange: (partial: Partial<AppConfig>) => void
  hotkeyWarnings?: { entry: boolean; viewer: boolean; waylandLimited: boolean }
}


const HOTKEY_FAILURE_COPY = window.api.platform === 'linux'
  ? 'Failed to register. On Wayland this usually means the compositor blocked the shortcut — see the Wayland notice above for a workaround.'
  : 'Failed to register — hotkey may be in use by another application'

export function QuickEntrySettings({ config, projects, onChange, hotkeyWarnings }: QuickEntrySettingsProps) {
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
        {hotkeyWarnings?.waylandLimited && (entryEnabled || viewEnabled) && (
          <div className="rounded-md border border-accent-orange/40 bg-accent-orange/10 px-3 py-3 text-xs text-[var(--text-primary)]">
            <p className="mb-2 font-semibold text-accent-orange">
              Wayland: Vicu hotkeys only fire when Vicu is focused
            </p>
            <p className="mb-2 text-[var(--text-secondary)]">
              Wayland doesn't let applications grab global keyboard shortcuts. To get true global capture, bind a shortcut in your desktop environment's keyboard settings that runs Vicu with a command-line flag:
            </p>
            <ol className="mb-3 list-decimal space-y-1 pl-5 text-[var(--text-secondary)]">
              <li>Open <strong className="text-[var(--text-primary)]">Settings → Keyboard → Custom Shortcuts</strong> (GNOME) or <strong className="text-[var(--text-primary)]">System Settings → Shortcuts → Custom Shortcuts</strong> (KDE).</li>
              <li>Add a new shortcut. Paste the command below as the <em>Command</em>.</li>
              <li>Set the key combo (e.g. <code className="rounded bg-[var(--bg-tertiary)] px-1">Alt+Shift+V</code>).</li>
              <li>Keep Vicu running in the tray — the shortcut wakes the running instance.</li>
            </ol>
            {!launcherCmd && (
              <div className="text-[var(--text-secondary)]">Loading command…</div>
            )}
            {launcherCmd?.kind === 'dev' && (
              <div className="mb-2 rounded border border-yellow-500/40 bg-yellow-500/10 px-2 py-1.5 text-[11px] text-yellow-600 dark:text-yellow-400">
                <strong>Dev build notice:</strong> the command below points at the unpackaged source tree and won't work outside this dev session. Use this feature from the installed AppImage for real keybinds.
              </div>
            )}
            {launcherCmd && (
              <div className="space-y-2">
                {entryEnabled && (
                  <div>
                    <div className="mb-1 text-[var(--text-secondary)]">Quick Entry command:</div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 overflow-x-auto whitespace-nowrap rounded border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)]">
                        {launcherCmd.quickEntry}
                      </code>
                      <button
                        type="button"
                        onClick={() => copy(launcherCmd.quickEntry, 'entry')}
                        className="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                      >
                        {copied === 'entry' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}
                {viewEnabled && (
                  <div>
                    <div className="mb-1 text-[var(--text-secondary)]">Quick View command:</div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 overflow-x-auto whitespace-nowrap rounded border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)]">
                        {launcherCmd.quickView}
                      </code>
                      <button
                        type="button"
                        onClick={() => copy(launcherCmd.quickView, 'view')}
                        className="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                      >
                        {copied === 'view' ? 'Copied' : 'Copy'}
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
                      {HOTKEY_FAILURE_COPY}
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
                      {HOTKEY_FAILURE_COPY}
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
