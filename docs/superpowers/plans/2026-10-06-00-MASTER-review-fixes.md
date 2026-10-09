# Master plan: fix everything from the 2026-10-06 review

Source: `docs/reviews/2026-10-06-comprehensive-review.md` (IDs `D-*` desktop, `A-*` Android,
`X-*` cross-app). This plan covers both repos: `vicu` (desktop) and `vicu-android`.

This document is the orchestration layer: decisions, order, scope per phase, tests and
release coordination. Before each phase starts, a detailed TDD sub-plan with exact code is
written next to this file (same style as `2026-06-11-vicu-review-fixes.md`). Code moves as
phases land, so sub-plans written now would go stale.

---

## Decisions

Confirmed with you (2026-10-06):

1. **Custom-list windows:** calendar windows for both apps (today; this week = through Sunday,
   weeks start Monday; this month = through month end) plus a synced per-list
   `include_overdue` flag, default on. An absent flag means on.
2. **Date-only due time:** local 23:59:59. Typed times ("3pm", "14:30") are kept as typed.
   "Today" means any time on today's local date, in both apps.
3. **Routine history:** old occurrences move into hidden archive carrier tasks on the server, so
   full history is visible on every device and survives reinstalls. The phone-only archive goes
   away.
4. **Desktop offline:** main-window edits that fail for network/server reasons go into the
   main-process offline queue (after that queue is fixed), with a visible pending/failed state.

Defaults I'll use unless you say otherwise:

| Topic | Default |
|---|---|
| Delivery | Updated 2026-10-06: one branch per repo (`fix/review-2026-10`), a local commit per phase, both apps released together as 1.9.0. Pushing, PRs and the release tag wait for your go-ahead at the end. |
| Android completion UX | Keep the "strikethrough until refresh" feel, but write the server result to Room so other screens, widgets and summaries are correct. |
| "!" shortcut | Becomes date-only, so stored at 23:59:59 like any other date-only value (it was 00:00 in both apps). |
| Numeric dates in NLP | ISO `2026-10-15` everywhere. Slash dates follow the device locale's day/month order in both apps. |
| Weekday abbreviations | "sun/sat/wed..." only count as dates after "on/next/this/by/due" or before a time. Full names always count. |
| Recurrence shorthand | Also accepted as the last word ("Water plants daily"), still not at the start ("weekly standup"). Add "biweekly"/"fortnightly" and "every <weekday>". |
| Android Inbox order | Adopt desktop's position order with drag reordering; keep Android's "exclude dated" option. |
| Android Today | Add an "Overdue" section above today's groups, like desktop. |
| Android search | Local first, title + description, completed tasks in a separate section, `LIKE` escaped. |
| Periodic refresh | Android background sync every 30 min (network required). Desktop task refetch on window focus, every 5 min while visible, reminder refresh every 15 min. |
| Backup API tokens | Revoked on logout in both apps. Titles get a short per-install suffix so two devices of the same model don't delete each other's tokens. |
| Logcat files | Removed from the tree with ignore rules (done). They stay in git history; a purge rewrites history and tags, so it waits for your explicit go-ahead. |
| iOS targets | Left as they are (they don't compile today); noted in docs. No iOS work. |
| String resources (i18n) | Deferred. |
| New features | Desktop relations UI and snooze are optional (phase 10), not part of "fix everything". |

---

## How the work lands

- **Gates per phase:** desktop `npm run verify` (typecheck + vitest + build); Android
  `./gradlew test assembleDebug` (plus lint once phase 9 adds it). Manual checks are listed in
  each sub-plan.
- **Shared fixtures:** cross-app rules get JSON fixtures in `test-fixtures/` in both repos (the
  pattern already used for `description-format-v1.json` and `custom-list-sync-v1.json`). Both
  test suites load the same file, so the next divergence fails a test.
- **Test server (recommended):** a local Vikunja v2.4 in Docker to settle the server-dependent
  questions at the end of this plan before phases 1, 2 and 6 rely on them.
- **Releases:**
  - After phases 0-2: patch releases (desktop 1.8.2, Android 1.8.3). These change no synced
    formats.
  - Phases 3-4 change synced data (custom-list flag, due-time rule, routine archive). Release
    both apps together as 1.9.0, with release notes about the new list behavior.
  - Later phases ship as normal releases.

### Phase overview

| Phase | Repo | Scope | Size | After |
|---|---|---|---|---|
| 0 | both | Security and hygiene | S | - |
| 1 | desktop | Data integrity | L | 0 |
| 2 | Android | Data integrity | L | 0 |
| 3 | both | Shared semantics (dates, lists, review, parser) | L | 1, 2 |
| 4 | both | Routine history archive | M | 3 |
| 5 | both | Offline, sync and reminders | L | 1, 2 |
| 6 | both | Performance | M | 5 |
| 7 | Android | UI and UX cleanup | M | 2 |
| 8 | desktop | Remaining desktop items | M | 1 |
| 9 | both | Build, CI and docs | S | any time; last pass at the end |
| 10 | both | Optional parity features | M | your call |

Phases 1 and 2 touch different repos and can run in parallel.

---

## Phase 0: security and hygiene

- [ ] **0.1 Committed logcat files (A-REPO-1).** You inspect `logcat.txt` / `logcat2.txt`.
  I `git rm` them and add `logcat*.txt`, `.debug-logs/` and `.codex-remote-attachments/` to
  `.gitignore`. If they contain real tokens or cookies: you revoke them in Vikunja (API tokens,
  sessions); I prepare a `git filter-repo` purge. Force-push only on your explicit go-ahead.
- [ ] **0.2 Desktop navigation guards (D-SEC-1).** New `src/main/web-security.ts`, registered on
  `app.on('web-contents-created')`:
  - `will-navigate`: allow only the app origin.
  - `setWindowOpenHandler`: open http/https/mailto/obsidian links with `shell.openExternal`,
    deny everything else.
  - deny `will-attach-webview`.
  - `assertTrustedSender(event)` helper used by the IPC handlers.

  Tests: URL allowlist unit tests. Manual: dropping a link doesn't navigate; Ctrl-click in a
  description opens the system browser.
- [ ] **0.3 Desktop attachment opening (D-IPC-2).** Executable/script extensions are revealed
  with `shell.showItemInFolder` instead of opened. Temp files go to a dedicated folder that is
  cleaned at startup and quit. Size cap on binary downloads.
- [ ] **0.4 Desktop preload event stripping (D-PRE-1).** Quick Entry/View preloads pass only
  payloads to page callbacks.
- [ ] **0.5 Android release logging (A-NET-1).**
  - Ktor logging only in debug builds (the app module passes a debug flag into Koin).
  - `Logger.d/i` become no-ops in release, plus a ProGuard `-assumenosideeffects` rule for
    `android.util.Log`.
  - `AuthDebugLog` runs in debug builds only, on the IO dispatcher, with a thread-safe
    formatter (UI-50).
- [ ] **0.6 Android backup rules (A-BAK-1).** Exclude `vicu_database`, `-shm`, `-wal` and
  `auth_debug.log` in both XML files.
- [ ] **0.7 Backup token revocation (D-AUTH-1, A-AUTH-1).** Store the backup token id at
  creation, `DELETE /tokens/{id}` on logout (best effort), and add a per-install title suffix
  for sibling cleanup. Both apps.
- [ ] **0.8 Electron 44.5.1 (D-DEPS-1).**

## Phase 1: desktop data integrity

- [ ] **1.1 UTF-8 decoding (D-API-1, D-UPD-1).** Collect Buffers and decode once in `request`,
  `requestMultipart` and the update checker. Test: a body split inside a multibyte character.
- [ ] **1.2 Pagination (D-REN-1, D-API-2).** Main paginates fully and applies
  `withoutNestedSubtasks` once on the complete set; the renderer stops paginating smart lists
  itself. Break on an empty page, honor `total_pages`, remove silent caps (or surface them).
  Test: a 50-item page with nested subtasks doesn't end pagination.
- [ ] **1.3 Task edits send diffs (D-REN-2).** Port Android's `MergePatches.task` to TypeScript
  as `taskPatch(original, edited)`, tested against the same cases as `MergePatchesTest.kt`.
  Every mutation site (TaskRow, use-task-actions, completion and cascade, Quick View) sends only
  changed fields; completion sends `{ done }`.
- [ ] **1.4 Project edits send diffs (D-PROJ-1, D-REV-1).** Review is fully broken today (every
  save gets a 422 for `children`), so this ships in the first patch release.
  - `projectPatch(original, edited)`.
  - Review actions send `{ description }`; reorder sends `{ position }`; archive sends
    `{ is_archived }`.
  - `parent_project_id` is sent only when it changes (to avoid lost updates; the server accepts
    an unchanged value from a write collaborator).
  - Review failures show an error.
  - Test: no project payload contains `children` or any other key outside the PATCH schema.
- [ ] **1.4a Quick View page size (D-QV-3).** Quick View is fully broken today (`per_page: 10000`
  gets a 422). Clamp `per_page` to 1000 in `createTaskCollectionSearchParams` and paginate
  `filter-builder.ts` results (all branches plus the `fetchViewTasks` position path) until
  `total_pages`. On a non-retriable error, fall back to the cached list and show the error.
  Test: no request has `per_page` above 1000; 2,500 tasks come back in three pages.
- [ ] **1.5 Date picker local dates (D-DATE-1).** Presets and the input use local
  `YYYY-MM-DD`. "Next week" matches `nextMondayAtMidnightISO`. The time-of-day change comes in
  3.1.
- [ ] **1.6 Atomic config/auth writes (D-CFG-1).** Write to a temp file, then rename, keeping a
  `.bak`. Loading falls back to `.bak` on a parse error. Tests with a temp dir.
- [ ] **1.7 Re-login keeps preferences (D-SETUP-1).** Setup merges into the existing config;
  `save-config` normalizes before caching.
- [ ] **1.8 Settings save partial changes (D-CFG-2).** New `save-config-patch` IPC; Settings
  sends only changed keys, so main-owned fields are never reverted.
- [ ] **1.9 Standalone upload (D-IPC-1).** Remove each task locally as soon as its upload
  succeeds.

## Phase 2: Android data integrity

- [ ] **2.1 Swipe uses current data (A-UI-1).** `rememberUpdatedState` for the task and
  callbacks in `SwipeableTaskItem`. `applyScheduleAction(taskId)` re-reads Room and sends only
  `due_date` or `priority`. Test: the schedule patch contains only that field.
- [ ] **2.2 Keep unsynced work (A-UI-2, A-ALARM-4).** A `LocalDataWiper` clears cache tables only
  (tasks, projects, labels, attachments). The offline queue and routine data are kept unless
  the server URL or user id changes (the user id is stored at login).
  - Setup validates an API token before touching anything and restores the previous
    credentials on failure.
  - Logout and "Clear cache" show pending/failed counts and require an explicit "discard
    unsynced changes".
  - Logout cancels task, snooze and routine alarms.
- [ ] **2.3 Optimistic updates keep relations and attachments (A-DATA-1).** A helper copies
  only scalar task fields onto the cached entity; it is used by `update`, `setTaskDone` and the
  offline paths. Test: an update preserves `relatedTasksJson` and `attachmentsJson`.
- [ ] **2.4 One sync at a time (A-SYNC-1).** A process-wide `Mutex` around `performSync`.
  `resetProcessingToPending` runs only when no sync holds the lock. Test: two concurrent runs
  process each action once.
- [ ] **2.5 Chunked IN queries (A-DATA-2).** Delete computed `deletedIds` in chunks of 500;
  apply the same chunking to other id-list queries. Test with 2,500 ids.
- [ ] **2.6 Reminder correctness (A-ALARM-1).**
  - A persisted registry of scheduled reminders lets rescheduling cancel anything no longer
    valid.
  - `AlarmReceiver` checks the task exists, is open and still has the reminder.
  - "Mark Complete" calls a new idempotent `setDone(taskId, true)`.

  Tests: the receiver's decision logic as a pure function.
- [ ] **2.7 Task detail autosave (A-UI-3, A-UI-17).**
  - Save on a debounce and on `ON_STOP`; keep the draft in saved state.
  - Report post-close errors through a global snackbar channel.
  - Block saving a blank title; guard the request id; a project move cascades the whole
    subtree with result handling.
- [ ] **2.8 Day clock (A-UI-4, UI-43).** A `DayClock` flow driven by midnight, `ON_RESUME` and
  date/time-zone broadcasts. Routines, the Today subtitle and `endOfTodayFlow` use it.
- [ ] **2.9 Completion writes Room (A-DATA-3, A-UI-7, A-UI-9).** Successful completion stores the
  server response; lists keep just-completed rows visible from their own set, so the UX is
  unchanged. Bulk complete uses the same path with one undo. Fix Logbook undo. No widget
  flicker.
- [ ] **2.10 Failed actions (A-SYNC-3).**
  - 401: keep the action pending and pause sync until re-auth.
  - 404 on update/delete: drop the action and remove the local row.
  - A banner shows the failed count with retry/discard.
  - The duplicate check also compares descriptions.
- [ ] **2.11 Collapsed sections restore (A-UI-5).** For ids it hasn't seen,
  `preserveExpansion` falls back to the saved collapsed set. Add a ViewModel-level test.
- [ ] **2.12 Attachments (A-ATT-1, A-UI-13).**
  - Stream uploads from the ContentResolver with an escaped filename; enforce the server's
    size limit (`max_file_size` from `/info`); do file I/O off the main thread. The MIME type
    can stay `application/octet-stream` because the server detects it.
  - Open or share non-image files through a FileProvider.
  - Delete asks for confirmation and rolls back on failure.
- [ ] **2.13 Temp ids (A-DATA-6).** A persisted counter instead of `-(epochSeconds)`.

## Phase 3: shared semantics (both repos, release 1.9.0)

- [ ] **3.0 Spec and fixtures.** `docs/cross-app-semantics-v1.md` plus
  `test-fixtures/cross-app-semantics-v1.json`, identical in both repos. Contents:
  - date-only due time and the display rule (no time shown for 23:59:59; legacy 00:00 also
    displayed as date-only)
  - Today/Upcoming/Overdue boundaries (local dates, exclusive tomorrow)
  - week start
  - custom-list windows and `include_overdue`
  - review date math
  - the NLP corpus (input + reference time + zone → title, due, priority, labels, project,
    recurrence)
- [ ] **3.1 One due-time rule (X-3, D-REN-4, D-PARSE-1, A-DATE-1, A-UI-6, A-UI-8, D-IPC-3).**
  - **Desktop:** a single `dateOnlyDue(localDate)` used by every setter (picker, set-today,
    postpone, Ctrl+T, context menu, Quick View, standalone, composer, title editor, Quick
    Entry, "!"). Keep chrono times when `start.isCertain('hour')`. Stop mutating the Quick Entry
    parse result.
  - **Android:** a `DueDates` policy used by every setter. The picker converts via the local
    date. The Today query becomes `< start of tomorrow`. Track `dueDateIsManual` so the Today
    seed doesn't beat a typed date. Show the time on task rows when it is explicit.
  - Fixture tests in both apps.
- [ ] **3.2 Custom lists (X-1, X-16, D-WEEK-1, D-QV-1).**
  - One window evaluator for desktop (CustomListView and Quick View share it) and Android's
    `CustomListFilterBuilder`.
  - `include_overdue` in the synced list value, with a toggle in both editors.
  - Both protocol normalizers preserve unknown fields from now on.
  - Server filter strings use local-day boundaries.
  - Tag and custom-list views filter before hiding nested subtasks, in both apps.
  - Quick View: inbox excluded from "anytime", `include_done` honored, `per_page` ≤ 1000 with
    pagination.
- [ ] **3.3 Review date math (D-REV-2, X-7).** Desktop `computeStatus` uses local dates.
  Fixture tests in both apps.
- [ ] **3.4 NLP parity (X-6, A-PARSE-1, D-PARSE-2, D-PARSE-3).**
  - Both: the weekday-abbreviation rule, trailing recurrence shorthand, biweekly/fortnightly,
    "every <weekday>" (weekly + due next occurrence).
  - Android: "next/this <weekday>", 24-hour and minute times after any date phrase, ISO and
    numeric dates.
  - Desktop: a single "!" rule everywhere (`extractBangToday`); locale-aware numeric dates.
  - Update `shared-parser-spec.md` and the Android README.
- [ ] **3.5 Display parity (X-11, X-12).** Android shows the year for other years and an
  Overdue section in Today.

## Phase 4: routine history archive (both repos, release 1.9.0)

- [ ] **4.0 Format.** Added to the semantics doc:
  - Archive parts are hidden done tasks with marker `vicu-routine:archive:v1` (older versions
    then treat them as malformed carriers and keep hiding them), holding
    `{routineId, part, occurrences}`, each at most 384 KiB of JSON.
  - Written down in `docs/cross-app-semantics-v1.md` section 6 with vectors in
    `test-fixtures/routine-archive-v1.json` (done).
  - The main carrier keeps a rolling window (400 days, shortened if the encoded payload would
    pass 384 KB).
  - `prunedBefore` marks the cut. Merges drop main-carrier occurrences older than
    `prunedBefore`, because they live in the archive. Archive merges are union + last-write-wins.
- [ ] **4.1 Shared merge fixtures.** Android `RoutineEnvelopeTest` and desktop `routines.test`
  run the same cases.
- [ ] **4.2 Desktop (D-RT-1, D-RT-3).**
  - Prune on write: archive first, verify, then advance `prunedBefore`.
  - History and CSV read the archive on demand; metadata filters hide archive parts.
  - Last-write-wins compares parsed times.
  - Routines are created with `done: true` in one call.
- [ ] **4.3 Android (X-4, A-RT-1).**
  - Same rules.
  - A one-time migration uploads the existing phone archive into archive parts; the Room table
    becomes a cache.
  - Create in one call (the create DTO sends `done`); no position anchoring for metadata
    carriers.
- [ ] **4.4 Rollout.** Ship together. Older versions may re-add pruned entries until updated;
  the merge rule removes them again.

## Phase 5: offline, sync and reminders

Desktop:

- [ ] **5.1 Replay classification (D-SYNC-1).** Drop only on 400/404/409/422, recorded in a
  visible log. Stop and keep the queue on auth (prompt re-auth), 5xx, 429 and network errors.
- [ ] **5.2 Queue model (D-SYNC-2, D-SYNC-3, D-QE-1).** Actions store patches (from 1.3).
  Creates keep every field. Labels become follow-up actions. Pasted images are stored on disk
  and uploaded on replay. Edits fold into a pending create (port of Android's `QueueMerge`),
  with temp-id remapping.
- [ ] **5.3 Main window uses the queue (decision 4).** On network/5xx/timeout failures the
  mutation helper enqueues the change and keeps the optimistic cache. Pending items get an
  indicator, replay invalidates queries, and pending creates work in the UI.
- [ ] **5.4 Errors and failed actions (D-REN-3).** A global `MutationCache.onError` toast; a
  failed-actions panel with retry/discard.
- [ ] **5.5 Queue storage (D-SYNC-4, D-SYNC-5).** Separate queue and cache files with async
  atomic writes, no pretty-printing. Replay honors cancellations.
- [ ] **5.6 Freshness (D-FRESH-1).** Refetch tasks on window focus (throttled) and every 5 min
  while visible; `onTasksChanged` also invalidates section tasks.
- [ ] **5.7 Reminders (D-NOTIF-1, D-NOTIF-2, D-NOTIF-4).**
  - Respect the master toggle.
  - Refresh every 15 min, on focus/resume and after complete/uncomplete, fetching only tasks
    with upcoming reminders.
  - Re-check the task when a reminder fires; long timers are re-armed by the periodic refresh.

Android:

- [ ] **5.8 Incremental refresh (A-DATA-4).**
  - Frequent syncs fetch `updated > lastSync`; a full reconcile runs on pull-to-refresh and at
    most daily.
  - One refresh implementation shared by the repository and `SyncEngine`.
  - No full refresh after every create; label deletions applied.
  - Logbook loads pages on demand.
- [ ] **5.9 Periodic sync (A-SYNC-2).** A 30-min periodic worker (network required): sync,
  reschedule alarms, update widgets. The daily summary runs after a sync attempt.
- [ ] **5.10 Refresh results (A-UI-14).** Show errors; mark synced only on success; reset
  staleness on login/logout/cache clear; refresh right after login.
- [ ] **5.11 Inbox id as a Flow (A-UI-15).**
- [ ] **5.12 Cheaper alarm rescheduling (A-ALARM-2).** Uses the 2.6 registry and cancels exact
  request codes only.
- [ ] **5.13 Daily summary timing (A-SUMMARY-1).** A one-time job rescheduled for the next
  local occurrence after each run, so DST is handled. Counts match desktop (tomorrow, not all
  future).
- [ ] **5.14 Project changes offline (A-UI-18).** Queue project patches; review actions handle
  results with rollback.

## Phase 6: performance

- [ ] **6.1 No more full-history scans (D-NOTIF-3, D-RT-2, A-CL-1).** Remember carrier task ids
  and fetch them directly. Discover new carriers with a `q` search on the marker name
  (`vicu-routine`, `vicu-custom-lists`) plus `done = true`; this works on 2.4.0, but searching
  for the literal `<!--` finds nothing. Fall back to a full scan at most daily.
- [ ] **6.2 Desktop server-side list filters (D-PERF-2).** Due-date filters for Today and
  Upcoming, a label filter for Tag, paged Logbook.
- [ ] **6.3 Android off-main mapping (A-UI-19, UI-28).** `flowOn(Dispatchers.Default)` for
  repository flows. Store the metadata-marker check in a column (Room migration 2→3).
  `remember` per-row derived values. Compute the drawer review badge off the main thread and
  only when review is enabled.
- [ ] **6.4 Create path (A-DATA-5, D-REN-7).** The server prepends new tasks (half the lowest
  position), so anchoring at the end stays. Make it cheaper: cache list-view ids and the last
  position per project, and set the position in the background after the create returns.
- [ ] **6.5 Desktop misc (D-PERF-1, D-IPC-6, D-AUTH-3, D-REN-5).** Run the foreground-app
  lookup only when a feature needs it; batch Quick View fetches; keep tokens in memory; trim
  per-row hooks.
- [ ] **6.6 Android search (A-UI-16).** Room first with the network in parallel; escaped
  `LIKE`; title + description; completed section; debounced, local-first relation search.

## Phase 7: Android UI and UX cleanup

- [ ] **7.1** Anytime builds the full project tree and toggles by id (A-UI-10). Project screen
  keeps refresh/error state (A-UI-11).
- [ ] **7.2** Accessibility (A-UI-20):
  - checkbox with role/state and a 48 dp target
  - TalkBack actions for complete and schedule
  - priority shown as text, not only colour
  - section expanded state announced
- [ ] **7.3** Task detail (UI-26): visible values for date, project and priority; a done
  toggle; single-line title; tappable subtasks.
- [ ] **7.4** Inbox manual ordering (X-8).
- [ ] **7.5** Drawer (UI-28): typed `combine`, lazy lists, deeper project levels, reliable
  reorder.
- [ ] **7.6** Setup (UI-35, UI-31): prefill the stored URL, back handling, IME padding, autofill
  hints, masked token field, warning for non-local http URLs.
- [ ] **7.7** Settings (UI-36, UI-37): grouped state, `rememberSaveable` dialogs, a confirm
  before clearing failed actions, correct gestures text.
- [ ] **7.8** Cleanup:
  - dead "Create label" control (UI-29)
  - RoutinesScreen flow per recomposition (UI-30)
  - single hex-colour parser (UI-38)
  - dead code (UI-39)
  - deprecated APIs (UI-40)
- [ ] **7.9** Navigation (UI-45, UI-46): share payload survives rotation, typed widget view
  targets, auth-aware start destination.
- [ ] **7.10** Polish (UI-42, UI-44, UI-47, UI-48, UI-49, UI-51):
  - no initial bounce animation; `contentType` on lists
  - split blocking/transient errors
  - picker prefill and search
  - chip times with minutes/locale
  - image viewer descriptions
  - confirm deleting preserved tables
  - lifecycle-aware collection; clear selection on navigation

## Phase 8: remaining desktop items

- [ ] **8.1** Windows AUMID matches `appId` (D-WIN-1).
- [ ] **8.2** Obsidian: inject `uid` only after the user links (D-OBS-1).
- [ ] **8.3** Browser native host without system Node (`ELECTRON_RUN_AS_NODE`), `execFile` for
  the registry (D-BRW-1).
- [ ] **8.4** OIDC: validate `state`, build URLs with `URL` (D-AUTH-2); comments and logging
  (D-AUTH-4).
- [ ] **8.5** Multipart filename escaping and size caps (D-API-3, D-IPC-5).
- [ ] **8.6** Viewer notifications for label/relation/attachment/project changes (D-IPC-4);
  Quick View cancel-edit and links (D-QV-2).
- [ ] **8.7** One shared config type module (D-CFG-3); `quick_view_enabled` default.
- [ ] **8.8** Update checker: prerelease-aware compare, periodic check (D-UPD-1).
- [ ] **8.9** Custom-list service: broadcast only on list changes, clean up duplicate carriers,
  GC tombstones after 90 days (D-CL-1).
- [ ] **8.10** Quick Entry description formatting (D-QE-2). Paste-to-create runs NLP and splits
  multi-line text into one task per line, with a confirmation (D-TL-1).
- 8.11 Dropped. The API has no restore for deleted tasks, so desktop's "cannot be undone"
  wording is correct (D-REN-6 withdrawn).
- [ ] **8.12** Badge excludes archived projects and updates at midnight (D-BADGE-1).
- [ ] **8.13** Linux autostart via XDG and a start-hidden option (D-LNX-1).
- [ ] **8.14** CSV formula-injection guard in both apps' routine export (D-RT-4).

## Phase 9: build, CI and docs

- [ ] **9.1 Desktop CI and repo (D-CI-1, D-REPO-1).** Prerelease from the tag pattern instead of
  hardcoded versions; remove tracked junk; package `resources/` once.
- [ ] **9.2 Desktop docs (D-DOC-1).** CLAUDE.md and AGENTS.md: test runner, `StartupWMClass`,
  merge-patch guidance.
- [ ] **9.3 Android CI (A-BUILD-1).** Workflow on push/PR: `test`, `lint`, `assembleDebug`.
- [ ] **9.4 Android build (A-BUILD-1).** AGP 9 migration
  (`com.android.kotlin.multiplatform.library`), direct Compose dependencies, Tink API update.
- [ ] **9.5 Android docs and repo (A-REPO-2, UI pass note).** CLAUDE.md (stale Hilt/Retrofit
  references), README NLP claims, an iOS status note, repo cleanup.

## Phase 10: optional parity features (only if you want them)

- [ ] Desktop: task relations UI (related, blocking, precedes, ...) and reminder snooze /
  notification actions.

---

## Server questions (answered on a local Vikunja 2.4.0)

Details are in section 2.1 of the review.

| # | Question | Answer | Plan change |
|---|---|---|---|
| 1 | Does `PATCH /projects/{id}` reject an unknown `children` key? | Yes, 422. Review is broken. | 1.4 ships in the first patch release |
| 2 | Does an explicit `parent_project_id: 0` fail for a write collaborator? | No, 200. | D-PROJ-1 is P2; 1.4 unchanged |
| 3 | Does the PATCH task response include `related_tasks` and `attachments`? | Yes. | A-DATA-1 is P2 (offline only); 2.3 unchanged |
| 4 | Does `q` match task descriptions? | Yes, including marker names in HTML comments, and with `done = true`. | 6.1 uses it |
| 5 | Does the server keep the multipart `Content-Type`? | No, it detects the type from the content. | 2.12 drops the MIME work; X-14 removed |
| 6 | Are new tasks appended at the end? | No, prepended. | 6.4 keeps anchoring |
| 7 | Can deleted tasks be restored? | No (404 after delete, no restore endpoint). | 8.11 dropped |
| - | Largest `per_page`? | 1000; 1001 is a 422. | New 1.4a (D-QV-3, P1) |

## Next step

On your go-ahead I'll start with phase 0. Item 0.1 needs you to look at the two logcat files
first; the rest of phase 0 doesn't depend on it.
