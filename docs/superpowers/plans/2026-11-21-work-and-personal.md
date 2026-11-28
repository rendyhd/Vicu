# Work and Personal (desktop, web and mobile)

Plan, 2026-11-21. State: the contract (section 22 of `docs/cross-app-semantics-v1.md`), the
`workMode` vectors and the shared rule are written, in both repos for the doc and the fixture.
Desktop and web are built (section 3, steps 1 to 7; harness `work-mode`, 61 checks in light, dark,
forced colours and reduced motion; the web walk in `scripts/ui-verify/web.mjs`). Not built on the
desktop: a shortcut for switching (decided: none for now). Mobile is built too (section 4): the
Android gate, `:shared:iosSimulatorArm64Test` and the iOS framework link on the Mac are green, and
`scripts/ui-verify/work-mode.mjs` passes on the emulator. Not run: the iOS app in a simulator.
Left on mobile: the Plan strip's per-day load counts every block, and Today's promises
"completed elsewhere" are not filtered by the mode. Nothing is committed or released yet.

One account holds work and private life. A switch at the top of the sidebar chooses All, Work or
Personal. Work shows the tasks that carry the work label or sit in a work project; Personal shows
everything else. Optionally Pro shows only in Work.

## 1. Decisions (settled with Rendy, 2026-11-21)

1. It is for focus, not privacy: search finds everything, reminders always fire.
2. Three states: All, Work, Personal. The second one is called "Personal", because Pro already has
   a "private" label kind.
3. Projects are marked one by one and subprojects inherit; a subproject can be taken out.
4. Routines and Events show in every mode.
5. The switch is manual: no schedule.
6. Nothing disappears for being empty: what is not marked work is Personal. A category without
   projects shows in All and Personal.
7. In Work mode a new task that would not be work gets the work label automatically; the Inbox is
   split by the label only and can never be a work project.
8. What work is syncs (`work.label`, `work.project.<id>`); the mode is per device.

Choices made while writing the contract, to confirm in review:

- A time block of the other mode stays on the Plan timeline as busy time (muted), so Plan my day
  never plans over a private appointment (22.4).
- A project or label screen reached through search says "3 more in Personal" and shows them on
  request (22.4).
- `pro.area` may be `"work"`, so Pro's area and the work projects are one definition (22.8).
- Badge, counts, widgets and Quick View follow the mode (22.4).
- With no work label set, a task made in Work mode stays Personal and a toast says so (22.6).

## 2. What exists

- `src/shared/work-scope.ts`: keys, `workProjectIds`, `isWorkTask`, `effectiveWorkMode`,
  `passesWorkMode`, `shownInWorkMode` (nested rows), `projectsShownInMode`,
  `workLabelForNewTask`, `newTaskStaysPersonal`, `workEntryToWrite`, `proAllowedInWorkMode`,
  `isWorkProArea`, `workModeClause`, `isWritableWorkValue`.
- `src/shared/__tests__/work-scope.test.ts`: every `workMode` vector (83 checks).

## 3. Desktop and web

Web gets everything below without extra work except where noted: the renderer is shared, the
config lives in IndexedDB there, and the synced preferences are a portable handler.

### Step 1: settings and plumbing

- `src/shared/config-types.ts`: `work_mode_enabled`, `work_mode`, `pro_only_in_work` on
  `AppConfig`; `src/main/config.ts` normalizes them (the mode through `parseWorkMode`). Kept
  through sign-out like the sidebar settings.
- `src/main/synced-preferences.ts`: `isWritablePref` takes `isWritableWorkValue`. Add the keys to
  the registry list in CLAUDE.md.
- `src/renderer/hooks/use-work-mode.tsx`: `WorkModeProvider` in `AppShell` next to
  `AvailabilityProvider`. It builds the `WorkScope` once from `useSyncedPrefs`, `useProjects`, the
  Inbox id and `useLabels` (a work label that no longer exists is no label), and gives
  `mode`, `scope`, `setMode`, `passes(task)`, `filter(tasks, parentOf?)`, `shownProjects`.
  With the feature off it answers `all` and does no work.
- Tests: config normalizer, the provider's scope from prefs.

### Step 2: lists

The caches stay unfiltered; the filter runs on display, where `isHiddenTask` and
`useParkedFilter` already run. One place per list family, not per view where possible:

- `hooks/use-tasks.ts`, `use-project-tasks.ts`, `use-project-sections.ts`, `use-filters.ts`
  consumers: Today, Upcoming, Anytime, Inbox, Tag, Project, sections. Project and section lists
  nest subtasks, so they pass `parentOf` (see `src/shared/nested-subtasks.ts`).
- `CustomListView` and `src/shared/custom-list-filter.ts` callers: filter after the evaluator.
- `use-logbook-tasks.ts`: add `workModeClause` to the server filter (the one server-side case),
  then filter the page on the device; `empty` skips the request. The mode is part of the query key.
- `use-guided-world.ts` (queues, review queue by `shownProjects`), `WeeklyReviewView`.
- Plan: `lib/plan-source.ts` follows the mode; `Timeline` keeps blocks of the other mode, muted,
  and `use-plan-busy.ts` counts them as busy for Plan my day.
- Counts: `use-project-progress.ts` open counts, sidebar counts and anything else that counts a
  filtered list.
- Project and Tag screens: the "N more in Personal / Work" line with Show, until the view is left.
- Search and the palette: no filter; a small "Work" or "Personal" mark on results of the other
  mode (`SearchView`, the command palette's task and project results).
- Guard test: a scan like `web-capabilities.test.ts` that lists the task-list hooks and fails
  when a new one does not go through the provider.

### Step 3: sidebar, marking and Settings

- The control: a three-segment switch at the top of `Sidebar.tsx` (above the smart lists), shown
  only while the feature is on. Text from the catalog (`workMode.*` keys, Dutch too). Palette
  entries "Switch to Work / Personal / All", and a shortcut (proposal: Mod+Shift+W cycles; check
  `host-shortcuts.ts` for the web).
- `ProjectTree` and the category headers use `shownProjects` (22.5); Settings, Projects keeps
  every project.
- `ProjectMenu`: "Work project" tick (`workEntryToWrite`, written with `writeSyncedPrefs`), not on
  the Inbox. A small mark on work projects in Settings, Projects.
- `components/settings/WorkModeSettings.tsx` (Settings, General): the switch, the work label
  picker, "Pro only in Work" (shown while Pro is on), a note when no work label is set, and a link
  to the projects list.
- Deleting the work label writes `work.label` `null`; deleting a project writes its entry `null`.

### Step 4: new tasks

- `useCreateTask` in `hooks/use-task-mutations.ts` is the choke point: add
  `workLabelForNewTask` to the labels of the create (queued with it offline), and toast
  "Added to Personal" with Show when `newTaskStaysPersonal`. Check each caller found by
  `grep useCreateTask` (composer, voice, paste, templates, drafts, Plan's drawn task, review
  "Add task", Pro import and sessions); duplicates opt out (22.6).
- Subtasks: the title-only subtask create gets the same rule.
- Quick Entry: main builds the payload (`offline/quick-actions.ts`), so it reads the mode from
  the config and the scope from the synced preferences and the cached projects. Not on the web.

### Step 5: main process

- Quick View (`quick-entry/viewer-filter.ts`): filter by the mode; needs the scope in main, the
  same helper as Quick Entry.
- `badge.ts`: the count follows the mode (it reads the renderer's count today: check where the
  number comes from before changing).
- Reminders: no change, by decision. Add a test that says so.

### Step 6: Pro

- `src/shared/pro/settings.ts`: `ProSwitches` gains the three mode settings and `isProEnabled`
  also asks `proAllowedInWorkMode`. Every caller already passes the config
  (`use-pro.ts`, `NewTaskComposer`, `main/index.ts`, `ipc-handlers.ts`, `handlers/portable.ts`,
  `ai/ipc.ts`, `pro-ledger-service.ts`, `project-counts-service.ts`): check each one still gets
  the full config. The ledger service must keep syncing in Personal mode: it should ask the plain
  switch, not the mode, so nothing is lost while Pro is hidden.
- `readProArea` / `inProArea`: accept `"work"` and take the work project set; `ProSettings.tsx`
  offers "Work projects" next to the categories, only while the feature is on.
- Vectors for both are in `workMode.proOnly` and `workMode.proArea`.

### Step 7: checks and docs

- Harness scenario `work-mode` (throwaway projects, label and tasks): mark a project, switch the
  three modes, check Today, the Inbox, the sidebar, the Logbook, a capture in Work mode, search,
  and Pro hidden in Personal. Run `node scripts/ui-verify/web.mjs` with the same walk.
- `docs/guide/work-and-personal.md` (and `npm run site:guide`), CLAUDE.md section, release notes.
- `npm run verify`, `npm run i18n:check`.

## 4. Mobile (`vicu-android`, Android and iOS)

Same contract, same release. One agent at a time in that repo.

- `shared/.../util/WorkScope.kt`: a port of `work-scope.ts`, with `WorkScopeFixtureTest` running
  the `workMode` vectors (pattern: `TaskOrderFixtureTest`).
- `SyncedPrefs.kt` / `SyncedPrefsStore.kt`: the two keys. Behaviour settings: `work_mode_enabled`,
  `work_mode`, `pro_only_in_work`.
- The switch at the top of the drawer (`DrawerLayout.kt` stays as it is; the control sits above
  the list), the project list by 22.5, "Work project" in the project menu, Settings.
- Lists, counts, widgets and the Logbook clause by 22.4 and 22.9; search unfiltered with the mark.
- New tasks by 22.6 (composer, share target, widget quick add, dictation).
- `ProSettings.kt`: the Pro gate and the `"work"` area.
- Its harness: a `work-mode` walk.

## 5. Order and size

1. Desktop steps 1 to 4: the feature is usable (about the size of project categories).
2. Steps 5 and 6: Quick View, badge, Pro.
3. Step 7, then mobile, then one release for both.

Open points to settle while building, none of them blocking:

- The shortcut for switching.
- Whether a custom list can opt out of the mode (an "Everything this week" list). Not in the
  contract; All covers it for now.
- Whether the mode should show somewhere outside the sidebar when the sidebar is collapsed.
