import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Work and Personal (cross-app semantics 22.4): every task list and count follows the mode. The query
// caches stay unfiltered and a list is filtered where it is shown. This scan lists the views that
// render task lists and fails when one of them, or the hook it gets its tasks from, does not ask for
// the mode. A new list view is added here, with how it follows the mode.

const RENDERER = resolve(__dirname, '../..')

/** What each list view reads: a file that must mention one of the markers, and why. */
const LISTS: Array<{ view: string; follows: Array<{ file: string; marker: RegExp }> }> = [
  { view: 'views/InboxView.tsx', follows: [{ file: 'views/InboxView.tsx', marker: /useProjectTasks\([^)]*,\s*true\s*,\s*true\)/ }] },
  { view: 'views/TodayView.tsx', follows: [{ file: 'views/TodayView.tsx', marker: /useTasks\([^)]*,\s*true\s*,\s*true\)/ }] },
  { view: 'views/UpcomingView.tsx', follows: [{ file: 'views/UpcomingView.tsx', marker: /useTasks\([^)]*,\s*true\s*,\s*true\)/ }] },
  { view: 'views/AnytimeView.tsx', follows: [{ file: 'views/AnytimeView.tsx', marker: /useTasks\([^)]*,\s*true\s*,\s*true\)/ }] },
  { view: 'views/CustomListView.tsx', follows: [{ file: 'views/CustomListView.tsx', marker: /useTasks\([^)]*,\s*true\s*\)/ }] },
  { view: 'views/TagView.tsx', follows: [{ file: 'views/TagView.tsx', marker: /useWorkMode/ }] },
  { view: 'views/ProjectView.tsx', follows: [{ file: 'views/ProjectView.tsx', marker: /useWorkMode/ }] },
  { view: 'views/LogbookView.tsx', follows: [{ file: 'hooks/use-logbook-tasks.ts', marker: /workModeClause/ }] },
  // The counts built from those lists.
  { view: 'sidebar open counts', follows: [{ file: 'hooks/use-project-progress.ts', marker: /useTasks\([^)]*,\s*true\s*,\s*true\)/ }] },
  { view: 'app icon badge count', follows: [{ file: 'hooks/use-today-overdue-count.ts', marker: /useTasks\([^)]*,\s*true\s*,\s*true\)/ }] },
]

const read = (file: string) => readFileSync(resolve(RENDERER, file), 'utf8')

describe('lists follow the Work and Personal mode', () => {
  for (const { view, follows } of LISTS) {
    it(`${view} asks for the mode`, () => {
      for (const { file, marker } of follows) {
        expect(
          marker.test(read(file)),
          `${file} must filter its tasks by the Work and Personal mode (cross-app semantics 22.4). ` +
            'Pass `scoped = true` to useTasks / useProjectTasks (a count or list that is shown), or use ' +
            '`useWorkMode().filter` / `workModeClause` from hooks/use-work-mode.tsx. The query caches stay ' +
            'unfiltered; filter on display. If this list really must not follow the mode, change this test and say why.',
        ).toBe(true)
      }
    })
  }

  it('Search is not filtered and marks the other mode instead', () => {
    expect(read('views/SearchView.tsx')).toMatch(/showWorkMark/)
    expect(read('hooks/use-search-tasks.ts')).not.toMatch(/useWorkMode|workModeClause/)
  })
})
