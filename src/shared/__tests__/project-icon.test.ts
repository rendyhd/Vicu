import { describe, expect, it } from 'vitest'
import { ICON_NONE, projectIconKey, projectIdOfIconKey, projectsWithoutIcon } from '../synced-prefs'

// A project drawn without its folder icon (docs/cross-app-semantics-v1.md section 11.3).

describe('project icons', () => {
  it('reads "none" as no icon and anything else as the folder', () => {
    expect(projectIconKey(5)).toBe('project_icon.5')
    expect(projectIdOfIconKey('project_icon.5')).toBe(5)
    expect(projectIdOfIconKey('project_icon.0')).toBeNull()
    expect(projectIdOfIconKey('task_order.project.5')).toBeNull()
    const values = { 'project_icon.5': ICON_NONE, 'project_icon.6': 'rocket', 'project_icon.7': null, task_order: 'none' }
    expect([...projectsWithoutIcon(values)]).toEqual([5])
  })
})
