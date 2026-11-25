import { useId, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { Checkbox } from '@/components/shared/Checkbox'
import { Switch } from '@/components/shared/Switch'
import { useAppConfig } from '@/hooks/use-app-config'
import { useLabels } from '@/hooks/use-labels'
import { buildProjectTree, useProjects, type ProjectTreeNode } from '@/hooks/use-projects'
import { writeSyncedPrefs } from '@/hooks/use-synced-prefs'
import { useSaveWorkModeConfig, useWorkMode } from '@/hooks/use-work-mode'
import { useMarkWorkProject } from '@/hooks/use-work-marking'
import { WORK_LABEL_KEY } from '../../../shared/work-scope'

/** The projects as rows with their depth; the Inbox is not listed and its subprojects take its place. */
function rowsOf(nodes: readonly ProjectTreeNode[], inboxId: number | null, depth = 0): { node: ProjectTreeNode; depth: number }[] {
  return nodes.flatMap((node) =>
    node.id === inboxId
      ? rowsOf(node.children, inboxId, depth)
      : [{ node, depth }, ...rowsOf(node.children, inboxId, depth + 1)],
  )
}

/**
 * Settings, General, Work and Personal (cross-app semantics section 22): the switch for the feature
 * (per device), the work label and the projects that are work (synced), and Pro only in Work (per
 * device). Not offered in standalone mode, where there is nothing to sync.
 */
export function WorkModeSettings() {
  const { t } = useTranslation()
  const { data: config } = useAppConfig()
  const { enabled, scope } = useWorkMode()
  const save = useSaveWorkModeConfig()
  const queryClient = useQueryClient()
  const markWork = useMarkWorkProject()
  const { data: labels } = useLabels()
  const { data: projects } = useProjects()
  const labelId = useId()
  const inboxId = config?.inbox_project_id || null
  const rows = useMemo(() => rowsOf(buildProjectTree(projects?.active ?? []), inboxId), [projects?.active, inboxId])
  if (!config || config.standalone_mode === true) return null

  const sortedLabels = [...(labels ?? [])].sort((a, b) => a.title.localeCompare(b.title))
  // Pro's own switch, not the mode-aware one: with "Pro only in Work" on, Pro reads as off in Personal.
  const proOn = config.pro_enabled === true

  return (
    <div className="rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] p-5" data-work-mode-settings>
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">{t('settings.workMode.title')}</h2>
      <p className="mb-4 text-xs text-[var(--text-secondary)]">{t('settings.workMode.note')}</p>

      <label className="flex items-start justify-between gap-4">
        <span className="min-w-0">
          <span className="block text-sm text-[var(--text-primary)]">{t('settings.workMode.enable')}</span>
          <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">{t('settings.workMode.enableNote')}</span>
        </span>
        <Switch checked={enabled} onCheckedChange={(checked) => void save({ work_mode_enabled: checked })} />
      </label>

      {enabled && (
        <>
          <label className="mt-5 flex items-start justify-between gap-4 border-t border-[var(--border-color)] pt-4">
            <span className="min-w-0">
              <span className="block text-sm text-[var(--text-primary)]">{t('settings.workMode.showAll')}</span>
              <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">{t('settings.workMode.showAllNote')}</span>
            </span>
            <Switch checked={config.work_mode_show_all === true} onCheckedChange={(checked) => void save({ work_mode_show_all: checked })} />
          </label>

          <div className="mt-5 border-t border-[var(--border-color)] pt-4">
            <label htmlFor={labelId} className="flex items-center justify-between gap-4">
              <span className="text-sm text-[var(--text-primary)]">{t('settings.workMode.label')}</span>
              <select
                id={labelId}
                value={scope.label ?? ''}
                onChange={(event) => void writeSyncedPrefs(queryClient, { [WORK_LABEL_KEY]: event.target.value === '' ? null : Number(event.target.value) })}
                className="max-w-[55%] rounded-control border border-border bg-bg-page px-3 py-1.5 text-sm text-text"
              >
                <option value="">{t('settings.workMode.labelNone')}</option>
                {sortedLabels.map((label) => (
                  <option key={label.id} value={label.id}>{label.title}</option>
                ))}
              </select>
            </label>
            <p className="mt-1.5 text-xs text-[var(--text-secondary)]">{t('settings.workMode.labelNote')}</p>
            {scope.label === null && (
              <div
                role="alert"
                className="mt-2.5 flex items-start gap-2 rounded-control border border-status-overdue/40 bg-status-overdue/8 px-3 py-2 text-xs text-text forced-colors:border-[CanvasText]"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-overdue" aria-hidden="true" />
                <span>{t('settings.workMode.noLabel')}</span>
              </div>
            )}

            <label className="mt-4 flex items-start justify-between gap-4">
              <span className="min-w-0">
                <span className="block text-sm text-[var(--text-primary)]">{t('settings.workMode.showWorkLabel')}</span>
                <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">{t('settings.workMode.showWorkLabelNote')}</span>
              </span>
              <Switch
                checked={config.work_mode_show_work_label === true}
                onCheckedChange={(checked) => void save({ work_mode_show_work_label: checked })}
              />
            </label>
          </div>

          <div className="mt-5 border-t border-[var(--border-color)] pt-4">
            <h3 className="text-sm font-medium text-[var(--text-primary)]">{t('settings.workMode.projects')}</h3>
            <p className="mb-2 mt-0.5 text-xs text-[var(--text-secondary)]">{t('settings.workMode.projectsNote')}</p>
            {rows.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">{t('settings.workMode.noProjects')}</p>
            ) : (
              <ul className="max-h-72 overflow-y-auto" data-work-projects>
                {rows.map(({ node, depth }) => (
                  <li key={node.id} style={{ paddingLeft: `${depth * 20}px` }}>
                    <label className="flex min-h-8 cursor-pointer items-center gap-2">
                      <Checkbox
                        checked={scope.projects.has(node.id)}
                        onChange={(event) => void markWork(node, event.target.checked)}
                      />
                      <span className="min-w-0 truncate text-sm text-[var(--text-primary)]">{node.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {proOn && (
            <label className="mt-5 flex items-start justify-between gap-4 border-t border-[var(--border-color)] pt-4">
              <span className="min-w-0">
                <span className="block text-sm text-[var(--text-primary)]">{t('settings.workMode.proOnly')}</span>
                <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">{t('settings.workMode.proOnlyNote')}</span>
              </span>
              <Switch checked={config.pro_only_in_work === true} onCheckedChange={(checked) => void save({ pro_only_in_work: checked })} />
            </label>
          )}
        </>
      )}
    </div>
  )
}
