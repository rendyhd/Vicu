import { effectiveWorkMode, readWorkLabel, workProjectIds, WORK_LABEL_KEY, workProjectKey, type WorkMode, type WorkModeSwitches, type WorkProject, type WorkScope } from '../shared/work-scope'

// Work and Personal in the main process (docs/cross-app-semantics-v1.md section 22): the mode of
// this device and what work is on this account. No Electron or Node imports, so Vicu web can share it.

/** The mode in effect on this device: `all` while the feature is off (or in standalone mode). */
export function currentWorkMode(config: WorkModeSwitches | null | undefined): WorkMode {
  return effectiveWorkMode(config)
}

/**
 * What work is, from the synced preference values (`getSyncedPrefs().values`), the Inbox and the
 * project list. A stored work label is used as is: the app that deletes the label writes null.
 */
export function currentWorkScope(
  prefs: Readonly<Record<string, unknown>>,
  projects: Iterable<WorkProject>,
  inboxProjectId: number | null | undefined,
): WorkScope {
  return {
    label: readWorkLabel(prefs[WORK_LABEL_KEY]),
    projects: workProjectIds(projects, (id) => prefs[workProjectKey(id)], inboxProjectId),
  }
}
