# Vicu desktop + Vicu Android: comprehensive review (2026-10-06)

Scope: full read-through of the desktop app (`vicu`, Electron 44 + React 18, v1.8.1) and the
Android app (`vicu-android`, Kotlin Multiplatform + Compose, v1.8.2 / versionCode 40), followed
by a feature comparison and a cross-app consistency check. Both apps talk to Vikunja API v2.4.0
(`api-docs.json` / `docs.json`). This is a report only; no code was changed.

Severity scale:

- **P0**: security exposure or silent data loss that needs action now
- **P1**: broken feature, lost updates or likely data loss
- **P2**: correctness, performance or consistency problem with real user impact
- **P3**: polish, hygiene, maintainability

IDs: `D-*` desktop, `A-*` Android, `X-*` cross-app. "Carried over" marks items already reported
in the 2026-06-11 reviews that are still open.

---

## 1. Executive summary

Both codebases are in better shape than in June. Android's merge-patch diffs, typed refresh
backoff, Room offline queue and OIDC state check are solid. Desktop tests and typecheck are
clean. The remaining problems cluster in five themes:

1. **The two apps overwrite each other.** Desktop sends whole cached task and project objects
   as merge patches (D-REN-2, D-PROJ-1, D-REV-1). Android sends minimal diffs. Any desktop edit
   from a stale cache reverts what Android (or the web UI) changed in the meantime, including
   review footers in project descriptions. Android has one equivalent hole: swipe actions keep the
   task object from the row's first composition, so swipe-to-schedule writes old values back
   (A-UI-1).
2. **The same data means different things in each app.** Synced custom lists use different date
   windows (X-1, carried over from June), "today" ends at a different instant (X-3), each app
   stores different due times for the same input (X-3/X-6), and review status day math differs
   (X-7).
3. **Sync and offline edge cases lose or corrupt data.** Desktop drops queued offline actions on
   auth or 5xx errors (D-SYNC-1) and corrupts non-ASCII text across response chunks (D-API-1).
   Android wipes relations and attachments from cached rows on offline edits (A-DATA-1), can
   run two sync passes at once and duplicate creates (A-SYNC-1), hits the SQLite variable limit
   on Android 8-11 (A-DATA-2), and deletes the offline queue on every re-login, logout and cache
   clear (A-UI-2).
4. **Reminders are unreliable across devices.** Android never cancels alarms for tasks completed
   elsewhere, and its "Mark Complete" notification action toggles, so it can reopen a task that
   was already done (A-ALARM-1). Neither app refreshes reminders from the server on a timer
   (A-SYNC-2, D-NOTIF-2).
5. **Full-history downloads.** Both apps repeatedly page through every completed task (custom
   list carrier scans, routine scans, logbook, Android full refreshes on each app open), and
   routine carriers grow without bound on desktop (D-RT-1).

Two desktop features don't work at all against a Vikunja 2.4.0 server: Review rejects every
save (D-REV-1) and Quick View can't load its list (D-QV-3). Both were confirmed on a local test
server (section 2.1).

Security items to handle first: committed Android logcat dumps containing auth-related lines
(A-REPO-1), missing navigation and window-open guards in the desktop main window (D-SEC-1), and
desktop opening server-provided attachments with `shell.openPath` (D-IPC-2).

### Fix first

| # | ID | Sev | App | One line |
|---|----|-----|-----|----------|
| 1 | A-REPO-1 | P0 | Android | `logcat.txt`/`logcat2.txt` committed; 264 lines match token/cookie/bearer patterns (not read); inspect, purge, rotate |
| 2 | D-SEC-1 | P1 | Desktop | No `will-navigate`/`setWindowOpenHandler`; a link can open a window that inherits the preload (`window.api`) |
| 3 | D-REN-2 | P1 | Desktop | Whole-object task PATCHes revert other clients' edits (projects too, D-PROJ-1, P2) |
| 4 | A-UI-1 | P1 | Android | Swipe actions use the row's first-composition task; swipe-to-schedule reverts newer edits |
| 5 | A-UI-2 | P1 | Android | Re-login (incl. session-expiry re-auth), logout and "Clear cache" delete unsynced offline edits |
| 6 | D-REN-1 | P1 | Desktop | Smart lists stop paginating after page 1 (per-page subtask filtering shrinks pages) |
| 7 | D-SYNC-1 | P1 | Desktop | Offline queue silently drops actions on expired session / 5xx |
| 8 | D-API-1 | P1 | Desktop | UTF-8 decoded per chunk; multibyte text corrupted, then written back |
| 9 | A-ALARM-1 | P1 | Android | Ghost reminders for tasks done elsewhere; "Mark Complete" can reopen them |
| 10 | D-REV-1 | P1 | Desktop | Review can't save anything: the PATCH includes `children` and gets a 422 (verified) |
| 11 | D-QV-3 | P1 | Desktop | Quick View asks for `per_page: 10000` and gets a 422; the popup shows an error (verified) |
| 12 | A-SYNC-1 | P1 | Android | Two sync workers can run concurrently; in-flight actions re-run (duplicate creates) |
| 13 | A-DATA-2 | P1 | Android | `DELETE ... NOT IN (all ids)` exceeds 999 SQL variables on Android 8-11 |
| 14 | D-DATE-1 | P1 | Desktop | Date picker "Today/Tomorrow" uses the UTC date: US evenings pick tomorrow, CET nights pick yesterday |
| 15 | X-1 | P1 | Both | Synced custom lists show different tasks per app (date windows); carried over |
| 16 | A-UI-3 / A-UI-4 | P1 | Android | Detail edits saved only on dispose (lost on process death); routine "today" frozen overnight |
| 17 | X-3 | P2 | Both | "Today" boundary and stored due times differ (five conventions); desktop "Tomorrow" shows in Android Today |
| 18 | D-RT-1 / X-4 | P2 | Both | Routine history never pruned on desktop (512 KB cap in ~1-3 years); union merge re-adds Android-pruned history |
| 19 | A-DATA-1 | P2 | Android | Offline edits drop relations + attachments from cached rows; subtasks pop to top level until sync |

---

## 2. What was checked

- Desktop: every file under `src/main`, `src/preload`, `src/renderer` (lib, hooks, stores,
  views, components, quick-entry, quick-view, task-parser), build config, CI workflows, docs.
- Android: `shared/src/commonMain` (auth, data, sync, util, parser, DI), `androidMain`, the
  `app` module (manifest, receivers, alarms, widgets, workers, tile, backup rules), build files,
  CI, docs. The Compose UI layer (`shared/.../ui/**`) was reviewed in a separate pass; its P1
  and most P2 findings were re-checked against the code (section 4.4 marks which).
- API conformance against `api-docs.json` (OpenAPI 3.1, Huma): merge-patch schemas,
  `additionalProperties: false`, read-only fields, nullable fields, pagination limits.
- Automated checks:
  - Desktop `npm run typecheck`: exit 0. `npx vitest run`: 21 files, 176 tests, all pass.
  - Android `./gradlew test`: BUILD SUCCESSFUL (shared + app unit tests).
- Behavior probes: desktop `chrono-node` run against the phrases the Android parser gets wrong
  (X-6).
- Server probes: a throwaway local Vikunja 2.4.0 (`vikunja/vikunja:2.4.0` in Docker, SQLite)
  with an owner and a write-permission collaborator. Results are in section 2.1. Findings that
  rely on them say "verified".

### 2.1 Server checks (Vikunja 2.4.0)

| Question | Result | Affects |
|---|---|---|
| PATCH a project with a `children` key | `422 unexpected property` at `body.children`, with or without the other fields. The same full object without `children` returns 200. | D-REV-1 |
| Write collaborator sends an unchanged `parent_project_id` (0, or the current parent) | 200. No admin right needed. | D-PROJ-1 (now P2) |
| `per_page` limits | 50, 100, 200 and 1000 are honored; 1001 returns `422 expected number <= 1000`. No `per_page` gives 50. | D-QV-3, D-REN-1 |
| Does the PATCH task response include `related_tasks` and `attachments`? | Yes, both, the same as GET. `labels` is left out when empty. | A-DATA-1 (now P2) |
| Does `q` match descriptions? | Yes, also together with `filter=done = true`. The marker names `vicu-routine` and `vicu-custom-lists` inside HTML comments match. A literal `<!-- vicu` matches nothing, so search for the marker name only. | D-NOTIF-3, carrier discovery |
| Attachment MIME type | Detected from the content: a PNG sent as `application/octet-stream` is stored as `image/png`. | A-ATT-1 (MIME point dropped), X-14 (removed) |
| Position of new tasks | Prepended: each new task gets half the lowest position (65536, 32768, 16384). | D-REN-7 |
| Deleted tasks | DELETE 204, then GET and PATCH return 404 (code 4002). There's no restore endpoint. | D-REN-6 withdrawn: desktop's "cannot be undone" wording is correct |
| Create with `null` dates and reminders | 201. | Both create paths |
| Relative reminder without `reminder` | 201; the server fills in the absolute `reminder`. | A-ALARM, D-NOTIF |
| Reminder with `reminder: ""` | `422 expected string to be RFC 3339 date-time`. | Reminder payload builders |
| `due_date: null` in a merge patch | 200; clears to `0001-01-01T00:00:00Z`. | Both clear-date paths |

---

## 3. Desktop (vicu)

### 3.1 P1

**D-SEC-1 (P1, security) No navigation or window-open guards on app windows.**
No `will-navigate`, `setWindowOpenHandler` or `web-contents-created` handler exists outside
`print.ts`. Dropping a link or file on the window (only `TaskRow` handles drops) navigates the
main window to that URL while the preload still exposes `window.api`. Ctrl/Shift/middle-click on
links in `RichTextEditor` (its `handleClick` returns `false` for modifier clicks) and
`target=_blank` anchors that `sanitizeTaskHtml` adds in Quick View (`viewer.ts:293`) open new
Electron windows instead of the OS browser. Child windows inherit the opener's webPreferences
unless a handler overrides them. A link placed in a shared project's task description is enough.
`ipc-handlers.ts` does not validate the sender either.
Fix: `app.on('web-contents-created')` → `will-navigate` prevent unless app URL;
`setWindowOpenHandler` → `shell.openExternal` for allowlisted schemes, `{ action: 'deny' }`.

**D-API-1 (P1, data corruption) Response bodies decoded chunk by chunk.**
`api-client.ts` `request()` and `requestMultipart()` do `responseBody += chunk.toString()`. A
multibyte UTF-8 character split across chunk boundaries becomes U+FFFD. Large paginated task
lists with non-ASCII titles/descriptions get corrupted, and because edits send whole objects
(D-REN-2) the corruption is written back to the server. `requestBinary` already does it right.
Fix: collect Buffers and `Buffer.concat(chunks).toString('utf8')`.

**D-REN-1 (P1) Smart lists silently truncated after the first page.**
`useTasks` paginates in the renderer via `fetchAllPages` and stops when a batch has fewer than
50 items, but main's `fetchTasks` applies `withoutNestedSubtasks` per page
(`api-client.ts:340`). Any page containing nested subtasks (or done subtasks of done parents)
shrinks below 50, so pagination stops. Deterministic for Logbook: one completed subtask of a
completed parent among the newest 50 caps Logbook at page 1. Upcoming is the most exposed
(page 1 is mostly overdue/today).
Fix: let main paginate fully (call without `page`) or return `total_pages` and stop on that.

**D-REN-2 (P1, lost updates) Every task edit sends the whole cached task.**
`TaskRow` (date, reminder, priority, project, title save), `use-task-actions`, and
`useCompleteTask`/`useUncompleteTask` send `{ ...task, ...changes }`; `createTaskPatch` then
forwards all writable fields. Anything another client changed since this cache was filled
(title, description, reminders, project, repeat) is reverted. Completion also uses embedded
`related_tasks.subtask` objects as patch sources; if those partial objects carry nulls,
merge-patch `null` clears fields. Android sends only changed fields
(`MergePatches.task(previous, current)`). Fix: diff against the cached original and send only
changed keys (port `MergePatches`).

**D-REV-1 (P1, verified on a v2.4.0 server) Desktop Review can't save anything.**
`use-review.ts:162-164` `projectToPayload` casts the whole project into the PATCH body. In
ReviewView and ProjectBranch that object is a `ProjectTreeNode`, which carries a `children`
array. Vikunja 2.4.0 rejects it: `422 validation failed, unexpected property body.children`
(section 2.1). So mark reviewed, set cadence, exclude and undo all fail on every project. The
failure is silent: there's no error UI, and the toast says the project was reviewed. The same
object without `children` is accepted (read-only fields are ignored). Fix: send
`{ description }` only.

**D-SYNC-1 (P1, data loss) Offline replay drops actions on non-retriable errors.**
`sync.ts` `replayPendingActions` discards a queued action on any error `error-classify` does not
call retriable. That includes "Session expired" (from `getConfigOrFail`), "API token is invalid"
and 5xx ("Server error" is not retriable). Offline Quick Entry tasks vanish when the user comes
back with an expired OIDC session or during server maintenance. Fix: drop only on
400/404/409/422; stop the replay and keep the queue on auth/5xx/429.

**D-DATE-1 (P1) Date picker presets pick the wrong day.**
`DatePickerPopover.tsx:59` formats presets with `d.toISOString().slice(0, 10)`, which is the UTC
date of the local time. In UTC-5 after ~19:00 local, "Today" sets tomorrow. In UTC+2 between
00:00 and 02:00, "Today" sets yesterday (instantly overdue). The initial input value
(`currentDate.slice(0, 10)`) shows the UTC date too. "Next Week" on a Sunday is +8 days, while
`date-utils.nextMondayAtMidnightISO` gives +1. Fix: build `YYYY-MM-DD` from local
`getFullYear/getMonth/getDate`.

**D-QV-3 (P1, verified on a v2.4.0 server) Quick View task lists are rejected by the server.**
`buildViewerFilterParams` asks for `per_page: 10000, page: 1` in every mode
(`filter-builder.ts:27, 35, 43, 132`), and the same params go to the position-sort path
(`fetchViewTasks`). Vikunja 2.4.0 caps `per_page` at 1000 and answers
`422 expected number <= 1000` (section 2.1). A 422 is not retriable, so Quick View gets an error
instead of tasks (or stale cached tasks). Fix: `per_page` ≤ 1000 with real pagination.

### 3.2 P2

**D-PROJ-1 (P2, lost updates) Project updates send cached fields wholesale.**
Rename (`SectionHeader.tsx:89-96`, `ProjectTree.tsx:45-52`), settings
(`ProjectSettings.tsx:62-69`), drag reorder (`AppShell.tsx:447-455`) and archive
(`use-task-mutations.ts:661-669`) all send title, description, hex, is_archived, position and
`parent_project_id` from cache. The stale `description` overwrites concurrent description
edits, such as a review footer just written by Android. Sending the unchanged
`parent_project_id: 0` is accepted, even from a write-only collaborator (verified, section 2.1).
Fix: send only changed fields.

**D-IPC-2 (P2, security) Attachments opened with `shell.openPath`.** `open-task-attachment`
writes the server-provided bytes to a temp file and opens it. `.exe/.bat/.cmd/.js/.lnk/.msi`
attachments (any collaborator can upload) run with one click, without Mark-of-the-Web. The temp
dir is never cleaned. Block executable types or use `shell.showItemInFolder`.

**D-SYNC-2 (P2, lost update) Offline replay sends stale full snapshots.** complete/uncomplete/
schedule-today/remove-due-date replays send the `taskData` captured at queue time as the patch,
overwriting later edits from other devices. Send `{ done }` / `{ due_date }` only.

**D-SYNC-3 (P2, data loss) Quick Entry offline queue drops fields.** `qe:save-task` queues only
title/description/dueDate/projectId (`ipc-handlers.ts:388-394`). Priority and recurrence are
lost. **D-QE-1**: labels and pasted images are also silently dropped offline (no task id), while
the UI says "saved offline".

**D-SYNC-6 (P2, parity) Main window has no offline queue.** Only Quick Entry/View enqueue. Main
window mutations roll back on failure, and **D-REN-3** there is no user-visible error for failed
mutations (93 `mutate` call sites, no `MutationCache.onError`/toast). Offline edits in the main
window silently disappear. Android is fully offline-first.

**D-IPC-1 (P2) Standalone upload duplicates on partial failure.** `qe:upload-standalone-tasks`
clears local tasks only if all uploads succeed, so a retry re-uploads the ones that already
went through.

**D-CFG-1 (P2) Non-atomic config writes.** `saveConfig` uses `writeFileSync` directly
(`config.ts:332`). A crash mid-write gives unparseable JSON → `loadConfig` returns null → Setup
screen, all settings and local custom lists gone. Same for `auth.json` in `token-store`
(logged out). `offline-cache.json` already uses tmp + rename; reuse that.

**D-SETUP-1 (P2) Re-login wipes preferences.** SetupView's OIDC/password path first saves a
partial config (`{vikunja_url, api_token: '', inbox_project_id: 0, auth_method, theme}`), wiping
hotkeys, notifications, quick entry, sound, theme and custom lists after Disconnect or account
switch. The later "preserve prefs" merge merges the already-wiped object. The API-token path
does not wipe (inconsistent).

**D-AUTH-1 (P2, security) Backup API token never revoked.** A full-access, 365-day token is
created at login; logout only calls `/user/logout` and deletes `auth.json`. Store the token id
and `DELETE /tokens/{id}` on logout. Android has the same gap (A-AUTH-1).

**D-NOTIF-1 (P2) Task reminders ignore the master notification toggle.**
`refreshTaskReminders`/`fireTaskReminder` never read `notifications_enabled`
(`notifications.ts:120-157, 315`), while Settings greys out the Task Reminders section when the
master toggle is off.

**D-NOTIF-2 (P2) Reminder timers are not refreshed from the server.** Reminders are
`setTimeout`s rebuilt only on init, settings save, resume, or a local edit touching
`due_date`/`reminders`. Reminders set on Android/web don't fire on desktop until one of those
events. Completing or uncompleting a task never calls `refreshTaskReminders`, so reminders fire
for completed tasks and recurring advances are not rescheduled. Reminders beyond 24.8 days rely
on a future refresh.

**D-NOTIF-3 / D-RT-2 (P2, perf) Repeated full scans of completed history.**
`notifications.refreshRoutineReminders`, `custom-list-service.fetchCarriers` (every 5 min, on
focus, on resume, after each edit) and `use-routines` all fetch `done = true` across every page
(in pages of 200). Routine carriers (up to ~683 KB of base64 each) ride along in every one of
these, plus Logbook. **D-NOTIF-4**: each `refreshTaskReminders` also pulls all open tasks.
Fix: remember the carrier task ids and fetch them directly. To find new carriers, a `q` search
for the marker works: it matches text inside description HTML comments, including with a
`done = true` filter (verified, section 2.1).

**D-PERF-2 (P2, perf) Smart lists fetch everything and filter client-side.** Today and Upcoming
fetch all open dated tasks. Anytime and Tag fetch all open tasks (Tag filters labels client-side
although the API supports label filters). Logbook fetches the entire completed history (up to
20 pages) on every mount/invalidation.

**D-FRESH-1 (P2) Visible windows go stale.** Task queries never refetch on Electron window
focus. AppShell only invalidates `['projects']` on `focus`, TanStack's `focusManager` relies on
`visibilitychange`, and there is no `refetchInterval`. `onTasksChanged` doesn't invalidate
`['section-tasks']`. This amplifies D-REN-2: the cache you edit from is older than it looks.

**D-RT-1 (P2, time bomb) Routine history never pruned on desktop.** `lib/routines.ts` and
`use-routines.ts` ignore `prunedBefore`. At ~527 bytes per occurrence the 512 KB envelope cap is
reached after ~994 days (1 slot/day), ~497 (2/day), ~331 (3/day). Encoding then throws "Routine
metadata is too large" and routine logging stops working on desktop. The union merge
(`mergeRoutinePayload`, `routines.ts:264-286`) also re-adds history that Android already pruned
and archived (X-4).

**D-PARSE-1 (P2) Parsed times are thrown away.** chrono parses "tomorrow at 3pm" correctly, but
NewTaskComposer (`endOfDayIso`), the TaskRow title editor (`setHours(23,59,59)`) and Quick Entry
overwrite the time with 23:59:59. `shared-parser-spec.md` says times are supported. Quick Entry
also mutates `lastParseResult.dueDate` in place.

**D-PARSE-3 (P2) "!" means different things per entry point.** The TaskRow title editor uses
`extractBangToday` (leading/trailing/standalone only). NewTaskComposer and Quick Entry treat any
"!" anywhere as "today" and strip every "!". "Hello! world" behaves differently depending on
where it's typed.

**D-REN-4 (P2) Due-time conventions inconsistent within desktop.** The date picker, set-today,
postpone and Ctrl+T use 00:00 local. NewTaskComposer, the title editor, Quick Entry, Quick View
"schedule today" and standalone mode use 23:59:59. This affects relative reminders ("1 hour
before" is 23:00 the previous day vs 22:59 the same day), intra-day sorting and overdue display.
See X-3.

**D-REV-2 (P2) Review status mixes local and UTC dates.** `review-metadata.ts` `computeStatus`
compares `lastReviewedAt` (a local date from `todayLocalIsoDate`) with `utcMidnight(today)`. In
UTC+2 after local midnight it shows "Reviewed -1 days ago". In US evenings a project reviewed a
minute ago shows "Reviewed yesterday", and overdue status flips at UTC midnight. Android uses
local dates.

**D-WIN-1 (P2) AppUserModelId mismatch.** `app.setAppUserModelId('com.vicu.app')`
(`index.ts:638`) differs from electron-builder `appId: com.rendyhd.vicu`. On Windows, toast
attribution and click-to-activate depend on the shortcut's AUMID.

**D-OBS-1 (P2) Obsidian notes modified without consent.** `getObsidianContext` injects a `uid`
frontmatter into the active note on every Quick Entry show while Obsidian is in the foreground,
even in "ask" mode and before the user links anything (`obsidian-client.ts:298-311`).

**D-PERF-1 (P2, macOS) Quick Entry waits on osascript.** `showQuickEntry` awaits
`getForegroundProcessName()` unconditionally (`index.ts:105`). On macOS that spawns an osascript
JXA process on every hotkey before the window shows, even with Obsidian and browser linking
disabled.

**D-BRW-1 (P2) Browser link silently requires system Node.js.** The native-messaging host runs
`node` (`vicu-bridge.bat` / `which node`). This is not documented in Settings or the README, and
the feature silently does nothing without Node. Use `ELECTRON_RUN_AS_NODE` with the app binary.
Registry writes go through `execSync` string commands (prefer `execFile`).

**D-CFG-2 (P2) Settings auto-save writes a stale snapshot.** SettingsView keeps the config from
mount and saves the whole object, reverting main-owned fields changed meanwhile (window bounds,
sidebar width, quick entry/view positions, last dialog dir, dismissed update version, last-used
project/label). `save-config` only protects `custom_lists`. Use a partial patch merged in main.

**D-DEPS-1 (P2) Dependencies.** Electron 44.4.5 → 44.5.1 is available (Chromium security
fixes). `npm audit`: 0 production vulnerabilities, 18 dev-only (electron-builder chain). Majors
behind: React 18, Tailwind 3, zustand 4, lucide 0.400, Vite 7, TypeScript 5.9.

### 3.3 P3

- **D-API-2** `requestAllPagesWithRetry` has no empty-page break; without `total_pages` it makes
  100 requests; caps silently at 5000 items; pages fetched sequentially.
- **D-API-3** Multipart filename not escaped (quotes/CRLF); no size caps on multipart or binary
  responses. **D-IPC-5**: attachment picker reads whole files into memory.
- **D-API-4** `withoutNestedSubtasks` hides open subtasks whose parent is done from every list
  (`api-v2.ts:49-65`). Android does the same (consistent), but such subtasks become unreachable
  except through the parent.
- **D-SYNC-4** Replay iterates a snapshot, so an undo during replay can't cancel an in-flight
  action; pending Quick View rows (`pending_x` ids) can't be acted on.
- **D-SYNC-5** `offline-cache.json` (queue + full task cache) is parsed and rewritten
  synchronously on the main thread for every count/add; pretty-printed.
- **D-IPC-3** Quick View "schedule today" uses 23:59:59 (`ipc-handlers.ts:616`), main app 00:00.
- **D-IPC-4** Label/relation/attachment/project mutations don't notify the viewer; Quick View is
  stale until its 30 s cache expires.
- **D-IPC-6** Quick View position sort fetches views + tasks per project sequentially (N+1) and
  refetches projects on every fetch.
- **D-CFG-3** `AppConfig`/`ViewerFilter`/`ReviewConfig` types duplicated by hand in main and
  renderer. `quick_view_enabled` defaults to false in `normalizeConfig` but `index.ts` treats
  undefined as enabled.
- **D-AUTH-2** OIDC `state` generated but never validated on redirect (Android validates). The
  auth URL is built by string concatenation (unencoded `client_id`; breaks if `auth_url` already
  has a query).
- **D-AUTH-3** `token-store` reads and decrypts `auth.json` on every token check (several per API
  call, main thread, Keychain on macOS). Cache in memory.
- **D-AUTH-4** Misleading comment in `_ensureBackupAPIToken`; `isEncryptionAvailable()` always
  true; verbose OIDC logging in production.
- **D-NOTIF-5 / D-RT-3** "After completion" routines count from the scheduled date of the last
  completed occurrence, not the completion time (same on Android; see X-4). Routine scheduling
  logic exists three times (main `notifications.ts`, renderer `lib/routines.ts`, Android). Routine
  creation is create(open) + update(done); if the second call fails an open carrier lingers
  (visible in the Vikunja web UI).
- **D-RT-4** Routine CSV export has no formula-injection guard (`=`, `+`, `-`, `@`).
- **D-UPD-1** Update checker: `compareVersions` returns NaN for prerelease tags; per-chunk UTF-8
  decode; checked only once at startup although the tray app runs for weeks.
- **D-CL-1** `broadcastLists` sends `viewer-config-changed` on every sync status change, so Quick
  View drops its cache every 5 min. Duplicate carriers are never cleaned; tombstones never GC'd.
- **D-QV-1** Quick View filter: `include_done` ignored; "anytime" includes the inbox (main
  Anytime excludes it); "this week" on a Sunday runs to next Sunday (page size: D-QV-3).
  **D-WEEK-1**: "this week" is defined three different ways in the desktop code.
- **D-QV-2** Quick View `cancelEdit` restores the row with `innerHTML`, dropping all listeners
  until re-render; description link clicks are not `preventDefault`ed; redundant ternary at
  `viewer.ts:259`.
- **D-QE-2** Quick Entry plain-text descriptions are sent unescaped and without `<p>`; with a
  link they are escaped and wrapped.
- **D-PARSE-2** Recurrence shorthand ("daily", "weekly") only works when it is the whole
  remaining input ("Water plants daily" never recurs). The spec lists `biweekly` and
  "every monday", which are not implemented. The spec still says sugar-date (the implementation
  uses chrono).
- **D-TL-1** Ctrl+V outside inputs instantly creates a task from the clipboard (multi-line text
  becomes one title, no NLP).
- **D-REN-5** Each TaskRow registers both `useDraggable` and `useSortable`; `useCompleteTask` in
  every row subscribes to router matches; `getLabelStyle` reads the DOM class per label per render.
- **D-REN-7** `placeNewTaskAtEnd` costs an extra request per create. It is needed: the server
  gives each new task half of the current lowest position, so new tasks land at the top of the
  list view (verified). Make it cheaper rather than removing it.
- **D-BADGE-1** Badge count includes tasks in archived projects and isn't recomputed at midnight.
- **D-LNX-1** "Launch on startup" is shown on Linux, where `setLoginItemSettings` is a no-op; no
  start-hidden option.
- **D-PRE-1** Quick Entry/View preloads pass raw `ipcRenderer` events (with `sender`) to page
  callbacks.
- **D-CI-1** `release.yml` hardcodes `v1.8.1` as a prerelease in two places; Windows builds
  unsigned; macOS signing silently optional.
- **D-REPO-1** Tracked junk: `.DS_Store` files, `.claude/settings.local.json` and
  `scheduled_tasks.lock` (in `.gitignore` but tracked), `PR4-AUDIT.md`, `vicu logo.png`, an `.xpi`.
  `resources/` is copied into both the asar and `extraResources`.
- **D-DOC-1** CLAUDE.md and AGENTS.md say "No test runner or linter is configured" (vitest,
  `npm test` and `npm run verify` exist). CLAUDE.md says `StartupWMClass: Vicu`
  (`electron-builder.yml` has `com.rendyhd.vicu`). The untracked AGENTS.md still says "always
  send complete objects".

---

## 4. Android (vicu-android)

### 4.1 P0 / P1

**A-REPO-1 (P0, potential credential exposure) Logcat dumps committed to the repo.**
`logcat.txt` (2,027 lines) and `logcat2.txt` (13,536 lines) were added in commit `482bffe`. A
pattern count for token/cookie/bearer/password-like strings matches 3 and 261 lines. The contents
were deliberately not read or reproduced in this review. Inspect them yourself; if they contain
real JWTs, refresh cookies or API tokens, rotate those, purge the files from history
(`git filter-repo`), and add `*.txt` logcat patterns to `.gitignore`. Root cause: A-NET-1.

**A-ALARM-1 (P1) Ghost reminders, and "Mark Complete" can reopen tasks.**
`AlarmScheduler.rescheduleAll()` (`AlarmScheduler.kt:64-76`) only (re)schedules open tasks
that have reminders. Alarms for tasks that were completed, deleted, or had their reminders
removed on another device are never cancelled. `AlarmReceiver` (`AlarmReceiver.kt:31-45`) shows
the notification without checking the task. Its "Mark Complete" action calls
`taskRepository.toggleDone(task)` on the Room copy (`NotificationActionReceiver.kt:58-60`).
If sync already stored `done = 1`, the toggle sets `done = false` on the server and reopens the
task. Fix: cancel alarms for every cached task id before rescheduling (or persist scheduled ids),
check task state in the receiver, and use an explicit `setDone(true)`.

**A-SYNC-1 (P1) Sync passes can overlap and re-run in-flight actions.**
`SyncEngine.performSync()` has no mutex. Two unique works exist: `sync_when_online` (KEEP) and
`sync_immediate` (REPLACE, from the widget checkbox and Settings). Both can run at once, and each
starts with `resetProcessingToPending()` (`SyncEngine.kt:70`), which resets the other run's
in-flight actions to pending. Creates replay twice: `findRecentDuplicate` only helps if the first
create already finished. Duplicate deletes and label adds fail and show up as "failed" actions.
Fix: a process-wide `Mutex` around `performSync`, or a single unique work name.

**A-DATA-2 (P1 on Android 8-11) SQL variable limit in deletion sweep.**
`refreshAll` (`TaskRepositoryImpl.kt:736`) and `SyncEngine.refreshAllFromServer` (`:304`) call
`taskDao.deleteNotIn(serverTaskIds)`, binding every task id, including the full completed
history. Room uses the framework SQLite (no `setDriver`), and SQLite before 3.32 (API 26-30,
`minSdk = 26`) allows 999 variables. Once an account has 1,000+ tasks, the first remote deletion
makes every refresh throw "too many SQL variables". The error is caught and logged, remote
deletions are never applied, and the alarm/routine/widget follow-up steps are skipped.
Fix: `deleteByIds(deletedIds)` in chunks of 500.

### 4.2 P2

**A-DATA-1 (P2, mostly offline) Optimistic updates drop relations and attachments from the
cache.** `Task.toDto()` (`TaskMapper.kt:219-244`) has no `relatedTasks` or `attachments`, so
`update()` (`TaskRepositoryImpl.kt:262-264`) and the offline path of `setTaskDone` (`:683-685`)
write a row with `relatedTasksJson = "{}"` and `attachmentsJson = "[]"`. Online this only lasts
until the PATCH response arrives, because the response includes `related_tasks` and
`attachments` (verified, section 2.1). Offline it lasts until the queued action syncs, because
`refreshAll` skips tasks with pending actions. Visible effects while offline:
- an edited subtask pops out as a top-level task in Today/Anytime/Project
  (`withoutNestedSubtasks` reads the child's `parenttask` relation)
- a parent loses its subtask list and progress, and completing it doesn't cascade to the
  subtasks
- attachments disappear from the detail sheet

Fix: start from the cached entity and replace scalar fields only.

**A-NET-1 (P2, privacy) Request logging and debug logs in release builds.**
`KtorClientFactory.create(enableLogging = true)` is never overridden in DI
(`KoinModules.kt:56-63`), so every request URL (server host, `q=` search terms, filter
expressions) goes to logcat at INFO. `Logger.android` calls `Log.d` unconditionally and there's
no `-assumenosideeffects` rule. `AuthDebugLog` appends auth events to `filesDir/auth_debug.log`
and rewrites up to 500 lines on every append, partly on the main thread (a `LaunchedEffect` and
`MainActivity` lifecycle). Gate both on `BuildConfig.DEBUG`.

**A-DATA-3 (P2, carried over) Online completion never updates Room.** By design the list
screens show a strikethrough via per-ViewModel `completedTaskIds` and leave Room unchanged
(`InboxViewModel.kt:118-126`). Consequences: other screens, search, the daily summary and
widgets still show the task as open until the next refresh. The widget removes the row
optimistically and then re-reads Room, so the task flickers back
(`ToggleTaskCallback.kt:40-69`). Repeating tasks keep their old due date locally. The offline
path does write `done = 1` (inconsistent). Suggested fix: write the server response to Room and
keep "recently completed" rows visible from a per-screen hold list.

**A-DATA-4 / A-CL-1 (P2; P1 for large accounts) Full-history downloads on every app open.**
`MainActivity.onResume` enqueues `performSync`, which runs `CustomListRepositoryImpl.carriers()`
(all `done = true` pages, `:127-144`) and `refreshAllFromServer` (all tasks, all pages,
`expand=subtasks`). List ViewModels then call `refreshAll()` again when `SyncStaleness` is older
than 60 s (`SyncStaleness.kt:23`). That is two or three complete downloads of the account per
app open, each followed by a full-table `getAllSync()` diff. Labels are never deleted locally
(`upsertAll` only). `refreshAll` is duplicated verbatim in `SyncEngine.refreshAllFromServer`.
Every task created from the entry sheet also triggers a full `refreshAll()`
(`TaskEntryViewModel.kt:469`). Fix: remember the carrier task id, use `updated > lastSync`
filters for incremental refresh, and fetch completed history only when Logbook/search needs it.

**A-SYNC-2 (P2) No periodic server sync.** Nothing fetches from the server in the background:
the widget worker (15 min) reads Room only, and token refresh and daily summary don't sync. So
reminders for tasks created or changed on desktop/web are not scheduled on the phone until the
app is opened, and widgets and the daily summary show stale data. Add a periodic `SyncWorker`
(e.g. 30-60 min, network constraint), at least for alarms.

**A-SYNC-3 (P2) Non-retriable failures freeze tasks.** 401 (after refresh failure), 403, 404 and
422 mark an action `failed` immediately. `getTaskIdsWithPendingActions` includes failed actions
(`PendingActionDao.kt:60-61`), so those tasks are never refreshed or deleted locally until the
user retries or discards in Settings. Example: a task deleted on desktop after a failed local
edit stays as a ghost row. Consider keeping auth failures pending (retry after re-login) and
surfacing failed actions with a banner. `findRecentDuplicate` also merges a deliberately repeated
same-title offline task within 15 min.

**A-ALARM-2 (P2, perf) Reminder rescheduling cost.** `cancelReminders` does 100
`PendingIntent.getBroadcast` binder lookups per task (`AlarmScheduler.kt:46-62`), and
`rescheduleAll` runs after any sync that touched a due date, reminder or done state, or any
deletion: 100 × N IPC calls. Persist the reminder count per task, or use one request code per
reminder.

**A-ALARM-4 (P2) Logout and "Clear cache" side effects.** Logout doesn't cancel task, snooze or
routine alarms, so notifications keep arriving for a logged-out account. Logout and
"Clear cache & re-sync" call `clearAllTables()` (`SettingsViewModel.kt:288-305`), which silently
discards unsynced pending actions and the local-only routine occurrence archive (history pruned
from the server after 400 days is then gone for good). Every re-login does the same (A-UI-2).
Warn when pending actions exist, and keep or export the archive.

**A-BAK-1 (P2, privacy) Backup rules exclude the wrong database name.** `backup_rules.xml` and
`data_extraction_rules.xml` exclude `vicu.db*`, but the database is `vicu_database`
(`DatabaseBuilder.android.kt:11`). The full task cache and pending queue go to Google cloud
backup and device transfer, and a restore brings back stale pending actions.
`network_security_config.xml` allows cleartext globally (needed for http self-hosting; consider
warning on non-local http URLs).

**A-DATE-1 (P2, cross-app) Today includes tasks due at tomorrow 00:00.** `getEndOfToday()`
(`DateUtils.kt:32-36`) returns the next local midnight and the Today query uses `<=`
(`TaskDao.kt:22-32`). Tasks set to "Tomorrow" from the desktop date picker or
`tomorrowAtMidnightISO` (00:00) appear in Android Today but in desktop Upcoming. Use `<` or
23:59:59.999. See X-3.

**A-PARSE-1 (P2) NLP coverage is narrower than documented.** The README advertises
`next Monday` and `today at 14:00`. There's no "next <weekday>" matcher, so "Call mom next
Monday" becomes title "Call mom next". 24-hour and minute times aren't parsed: "today at 14:00"
leaves "at 14:00" in the title with due 23:59:59. Times only work as
`today|tomorrow [at] N am/pm`, and numeric dates aren't supported (`ExtractDates.kt:203-301`).
Weekday abbreviations match as words: "Buy sun cream" gets due Sunday and title "Buy cream"
(desktop's chrono does the same, X-6).

**A-SUMMARY-1 (P2, carried over) Daily summary timing drifts.** A 24 h `PeriodicWorkRequest` with
an initial delay (`DailySummaryScheduler.kt:71-80`) is inexact and drifts by an hour after DST
changes until reboot or a settings change. Counts come from possibly stale Room (A-SYNC-2).
"Upcoming" counts all future tasks, while the desktop summary counts tomorrow.

**A-ATT-1 (P2) Attachments fully buffered in memory.** Share-intake and the picker read whole
files with `readBytes()` (`FileUtils.kt:14`) and downloads return a `ByteArray`. A large shared
video can OOM the app. There's no size cap; the server reports its limit in `/info`
(`max_file_size`, 20 MB by default). Filenames are not escaped in `Content-Disposition`
(`VikunjaApiService.kt:157-173`). Every upload is sent as `application/octet-stream`, which is
harmless: the server detects the type from the content (verified, section 2.1).

### 4.3 P3

- **A-NET-2** `SKIP_AUTH_PATHS` uses substring `contains` ("/info", "/login"). The JSON config
  lacks `coerceInputValues`, so one unexpected `null` in a non-null field fails a whole page.
- **A-DATA-5** `create()` awaits `anchorNewTaskAtEnd` (three sequential requests) before
  returning; `updatePosition` re-fetches project views every time (no cache). Offline-created
  tasks get no local alarm until synced.
- **A-DATA-6** Temp ids start at `-(epochSeconds)` per process and count down. Restarting within
  N seconds after creating more than N offline tasks reuses an id still in the queue.
- **A-ALARM-3** Relative reminders fall back to `dueDate` only (`relative_to` start/end ignored)
  when the server hasn't filled the absolute `reminder` yet (offline / before the round trip).
- **A-AUTH-1** Refresh exceptions are classified as `ServerError` (`NetworkError` unused).
  `resetBackoff()` runs after `scheduleProactiveRefresh()`, so the new schedule sees the old
  backoff floor. `hasApiToken()` is true for undecryptable ciphertext, so the backup token isn't
  recreated after a keystore reset. The backup token is not revoked on logout (as on desktop).
  Sibling cleanup deletes other tokens with the same title "Vicu — {manufacturer model}", so two
  phones of the same model delete each other's backup tokens.
- **A-RT-1** Routine carriers are created open, then PATCHed done (two calls; an open carrier
  lingers if the second fails), and creation also runs `anchorNewTaskAtEnd`. LWW compares ISO
  strings lexicographically; kotlinx `Instant.toString()` uses variable fraction digits while
  desktop always writes `.sssZ` (only matters within the same second).
- **A-PAR-7 (carried over)** Relative date labels never show the year ("MMM d"), so a task due
  next January is ambiguous (desktop appends the year).
- **A-BUILD-1** AGP 9 deprecations (`android.builtInKotlin=false`, `android.newDsl=false`, KMP +
  `com.android.library`), deprecated `compose.*` accessors, `materialIconsExtended` pinned to
  1.7.3, Tink `getPrimitive` deprecated, unchecked casts from 5+-flow `combine` in
  `DrawerViewModel`/`SettingsViewModel`, `SettingsScreen.kt` over 2,600 lines. CI runs only on
  release publish (no PR/push checks, no lint).
- **A-REPO-2** `vicu logo.png` (spaces), `docs.json` duplicates the API spec, iOS stubs in tree.

### 4.4 Android UI layer (`shared/.../ui/**`)

From a dedicated pass over screens, ViewModels and components. Items marked **[verified]** were
re-checked line by line for this report. The rest are reported with file references but were
not individually re-verified.

**P1**

**A-UI-1 (P1, lost updates) [verified] Swipe actions run with the task from the row's first
composition.** `rememberSwipeToDismissBoxState` builds its state once (`rememberSaveable` with
no keys), so the `confirmValueChange` lambda captures the first `requestToggleDone`/`onSchedule`
(`SwipeableTaskItem.kt:70-105`). Rows are keyed by task id, so they stay composed while the task
changes underneath (sync from desktop, or an edit in the detail overlay). A swipe-left then calls
`viewModel.scheduleTask(staleTask)` (e.g. `TodayScreen.kt:186`), and
`update()` diffs the stale copy against the fresh Room row. Every field changed since then
(title, description, priority, project, reminders, repeat) is sent back with the old value. It
also uses a stale subtask count for the "complete subtasks too?" prompt. Fix:
`rememberUpdatedState` for `task`/callbacks, and make `applyScheduleAction` send only
`due_date` or `priority`.

**A-UI-2 (P1, data loss) [verified] Re-login, logout and "Clear cache" wipe unsynced work.**
Every successful login in Setup (OIDC `:180`, password `:221`, API token `:247-255` in
`SetupViewModel.kt`) calls `database.clearAllTables()`. That includes the `NeedsReAuth` re-login,
which is exactly when offline edits are most likely to be queued. The API-token path wipes
before validating the token and calls `logout()` on failure, so a typo deletes data and signs
out. Logout and "Clear cache & re-sync" do the same (A-ALARM-4); the clear-cache dialog says "You
will not be signed out" and doesn't mention unsynced changes, although the pending count is
already available on that screen. Fix: wipe only when the server or user id changes, after
validation; keep `pending_actions` and `routine_occurrence_archive`; show pending counts.

**A-UI-3 (P1) [verified] Task detail saves only when the overlay is disposed.**
`DisposableEffect(Unit) { onDispose { flush(); saveIfChanged() } }` (`TaskDetailScreen.kt:140-147`)
is the only save path. Background the app with the sheet open and let the process die, and
title/description edits are lost. A failed save after the sheet closed is never shown. Fix:
debounced autosave plus save on `ON_STOP`, persist the draft, global error channel.

**A-UI-4 (P1) [verified] Routine "today" frozen at ViewModel creation.** `TodayViewModel.kt:53`
and `RoutinesViewModel` compute `todayIn(...)` once, and these ViewModels live for the process.
After an overnight session, Today and Routines show yesterday's occurrences, and completing or
skipping logs against yesterday's date. Task lists were fixed with `endOfTodayFlow`; routines were
not.

**P2**

- **A-UI-5 [verified]** The fix for persisting collapsed project sections (latest feature
  commit `8a936c3`) has no effect: `restoreExpansion` is applied, then the collector runs
  `preserveExpansion(newState.sections, current.sections)` with an empty `current`, which defaults
  every section to expanded (`ProjectViewModel.kt:122-141`, `ProjectSections.kt:69-85`).
- **A-UI-6 [verified]** "Pick a date" stores 12:00 **UTC** of the picked day
  (`DatePickerDialog.kt:53-58`) and pre-selects from the stored instant's UTC millis. In
  UTC+12..+14 tasks land a day late. In the Americas a 23:59:59 local due date pre-selects the
  next day, and confirming shifts it.
- **A-UI-7 [verified]** Multi-select "Complete" just calls `toggleDone` per task
  (`SelectionViewModel.kt:91-94`): no optimistic state, results ignored, and since online
  completion doesn't touch Room (A-DATA-3) the rows stay open until a refresh. Other bulk actions
  also ignore results and run sequentially.
- **A-UI-8 [verified]** Opening entry from the Today FAB seeds due = today 23:59:59, and the
  seed beats the parsed date (`TaskEntryViewModel.kt:347-352`), while the parser still strips
  the word. "Buy milk tomorrow" from Today becomes due today, titled "Buy milk". The parsed
  project overrides a manual project, but the parsed date doesn't (inconsistent precedence).
  Every create also triggers a full `refreshAll()`.
- **A-UI-9 [verified]** Logbook "undo un-complete" calls `toggleDone(task)` with the
  still-done Room copy, so it sends `done = false` again instead of re-completing
  (`LogbookViewModel.kt:71-75`). Logbook also refetches every done task on open.
- **A-UI-10 [verified]** Anytime shows top-level projects and their direct children only
  (`AnytimeViewModel.kt:60-93`). Tasks in projects three levels deep never appear. Expand state
  is keyed by list index.
- **A-UI-11 [verified]** `ProjectViewModel` replaces the whole UI state on every Room emission,
  resetting `isRefreshing` and `error` (`ProjectViewModel.kt:135-141`).
- **A-UI-12 [verified, also desktop]** Tag and custom-list views apply `withoutNestedSubtasks`
  before filtering, so a subtask carrying the label (or matching the filter) is hidden whenever
  its open parent doesn't match. Desktop's Tag view has the same order of operations (X-16).
- **A-UI-13 [verified]** Non-image attachments can't be opened or saved:
  `TaskDetailViewModel.downloadAttachment` has no callers, although the README promises
  "upload, download, and share". Attachment delete is optimistic with no confirmation or
  rollback, and subtask creation has no offline path.
- **A-UI-14** List ViewModels ignore `refreshAll()` results (June NEW-14, still open) and call
  `syncStaleness.markSynced()` even when every refresh failed. A failed/offline refresh suppresses
  the next screen's refresh for 60 s, and a re-login within 60 s shows an empty Inbox.
  `SyncStaleness` is never reset on logout/login.
- **A-UI-15** The inbox project id is read once at ViewModel construction (Drawer + 7 VMs).
  Changing the inbox in Settings, or a first run where login and inbox selection are separate
  steps, leaves stale exclusions/defaults until process restart.
- **A-UI-16** Search waits for the network (`refreshAll(q)`) before observing Room, keeps the
  previous query's results during the request, and uses an unescaped, open-only `LIKE` (June
  NEW-16, still open). Relation search fires an undebounced full `refreshAll` per keystroke.
- **A-UI-17** Detail screen: a title that is only NLP tokens saves as empty (rejected by the
  server, error invisible); a late save can overwrite a newly opened task (no request-id guard);
  moving a parent moves direct subtasks only.
- **A-UI-18** Review actions ignore results; project updates have no offline queue, so a review
  marked offline looks done but is lost.
- **A-UI-19 (perf)** Room-to-domain mapping and the metadata-marker scan run on the main thread
  for every emission of every live list (no `flowOn`); attachment file reads run on Main.
- **A-UI-20 (accessibility)** The task checkbox is a 24 dp clickable box with no role or state;
  there are no TalkBack custom actions for complete/schedule (swipe only); priority is shown by
  colour only; several targets are 14-16 dp.

**P3** (reported by the UI pass)

Detail screen hides current values behind icons and can't complete the task itself; the title
accepts newlines. Drawer: unchecked-cast `combine`, review badge computed on Main even when
review is disabled, depth-1 projects only, non-lazy reorder lists. Dead "Create new label" in the
bulk label picker. RoutinesScreen creates a new Flow on every recomposition. iOS targets are
declared, but 20 commonMain UI files import `android.*`/`androidx.activity`, so an iOS build
would not compile. The API token field is not masked and http URLs are accepted without a
warning. Gestures help text is outdated. Hex colour parsing is duplicated about 10 times. There
is dead code (`rescheduleTask` in 7 VMs, `CompletionUndoSnackbar`, ...), deprecated material3
and clipboard APIs, no string resources, hard-coded colours, a cold-start Inbox flash before
Setup, the share payload is lost on rotation, `collectAsState` and
`collectAsStateWithLifecycle` are mixed, and `AuthDebugLog` uses a shared `SimpleDateFormat`
across threads.

---

## 5. Cross-app comparison

### 5.1 Feature matrix

"Yes" means present and wired. Differences in behavior are covered in 5.2.

| Area | Feature | Desktop | Android | Note |
|---|---|---|---|---|
| Lists | Inbox | Yes (manual order) | Yes (newest first, "exclude dated" option) | X-8 |
| | Today | Yes (Overdue / Today sections, routines) | Yes (single grouped list, routines) | X-3, X-11 |
| | Upcoming | Yes | Yes | |
| | Anytime (inbox excluded) | Yes | Yes | Quick View "anytime" includes the inbox (D-QV-1) |
| | Logbook | Yes (all history) | Yes (retention window) | X-10 |
| | Tag view | Yes | Yes | X-16 |
| | Search | Yes (server, title + description) | Yes (local, title only) | X-9 |
| | Custom lists (synced) | Yes | Yes | X-1 |
| | Projects with nested sections | Yes | Yes | |
| | Project review | Yes | Yes | X-7, D-REV-1 |
| | Routines (health/chore, slots, history, CSV, archive) | Yes | Yes | X-4 |
| Task editing | NLP quick add | Yes (chrono) | Yes (regex subset) | X-6 |
| | Rich-text notes | Yes (TipTap) | Yes (rich editor with Vikunja HTML profile) | |
| | Attachments | Yes (picker, drag-drop, pasted images inline, open) | Partial (upload via picker/share/paste, view images, delete; no open/save for other files) | A-UI-13, A-ATT-1, D-IPC-2 |
| | Labels: assign / create / edit / delete | Yes | Yes | |
| | Reminders (absolute + relative, default offset) | Yes | Yes | X-5 |
| | Recurrence presets | Yes | Yes | identical mapping |
| | Subtasks, cascade complete | Yes | Yes (restores auto-completed children on undo) | |
| | Other relations (related, blocking, ...) | No | Yes | desktop gap |
| | Multi-select bulk actions | Yes | Yes | |
| | Manual reordering | Yes (tasks, sections, projects, custom lists, drag to sidebar) | Partial (project lists, drawer) | |
| | Swipe gestures | n/a | Yes | |
| | Keyboard shortcuts | Yes | n/a | |
| | Comments, assignees, favorites, kanban | No | No | shared gap |
| Capture | Global quick entry | Yes (hotkey window, Obsidian/browser link) | Quick Settings tile, share target | platform-specific |
| | Glanceable view | Quick View window, tray, badge | Task list widget, routine widget | |
| Notifications | Per-task reminders | Yes (in-memory timers) | Yes (AlarmManager, snooze, Mark Complete) | X-5 |
| | Daily summaries (morning/afternoon) | Yes | Yes | A-SUMMARY-1 |
| | Routine reminders | Yes | Yes | |
| Offline | Offline edits | Quick Entry/View only | Full queue (create, update, complete, delete, labels) | D-SYNC-6 |
| | Standalone (no server) mode | Yes | No | |
| Auth | API token / OIDC / password + TOTP | Yes | Yes | |
| | Session upkeep | silent OIDC re-auth, JWT renewal, backup API token | proactive refresh, WorkManager refresh, backup API token | X-13 |
| Other | Completion sound | Yes (custom file) | Yes | |
| | Print, update checker, launch at login | Yes | n/a | |
| | Theme light/dark/system | Yes | Yes (+ dynamic color) | |
| | Configurable bottom bar, label order | n/a | Yes | |

### 5.2 Behavioral inconsistencies

Each item says what each app does and which behavior should become canonical.

**X-1 (P1, carried over from June PAR-2) Synced custom lists evaluate differently.**
The list definition syncs through the same carrier task, but the date windows differ:

| Filter | Desktop (`CustomListView.tsx:18-66`) | Android (`CustomListFilterBuilder.kt:140-175`) |
|---|---|---|
| `today` | due ≤ end of today (overdue included) | start of today ≤ due < tomorrow (overdue excluded) |
| `this_week` | due ≤ Sunday 23:59:59 (calendar week, overdue included) | today ≤ due < today + 7 days (rolling, overdue excluded) |
| `this_month` | due ≤ last day of month (overdue included) | today ≤ due < today + 1 month (rolling, overdue excluded) |
| `no_due_date` | `due_date = NULL_DATE` | NULL_DATE or empty |

Quick View (`filter-builder.ts`) is a third variant ("this week" on a Sunday runs to next
Sunday). Pick one definition, put it in `docs/` next to `description-format-v1.md` with test
vectors, and port it to all three evaluators. The usual meaning is "overdue + due in window" for
`today`, and calendar week/month for the others.

**X-2 (P1) Write semantics: desktop overwrites, Android diffs.**
Desktop task and project edits send the full cached object (D-REN-2, D-PROJ-1, D-REV-1,
D-SYNC-2). Android sends only changed fields (`MergePatches.task/project/label`) and folds
queued patches together. In mixed use, every desktop edit can silently revert recent Android or
web changes: titles, descriptions, reminders, review footers. Canonical: Android's
diff-against-previous approach. Desktop should port `MergePatches`.

**X-3 (P2) "Today" ends at different instants, and stored due times differ.**

| Situation | Desktop | Android |
|---|---|---|
| Today list upper bound | ≤ today 23:59:59.999 | ≤ tomorrow 00:00:00 (A-DATE-1) |
| Date picker / quick pick "Today" | 00:00 local | 23:59:59 local (also Today FAB seed, multi-select "Today", swipe) |
| "Tomorrow" | 00:00 (picker, context menu) or 23:59:59 (composer, Quick Entry) | 12:00 (quick pick and NLP) |
| "Next week" | Monday 00:00 (Sunday: +8 days in the picker) | Monday 09:00 |
| Calendar "pick a date" | 00:00 local (with the UTC-date bug, D-DATE-1) | 12:00 UTC (A-UI-6) |
| NLP date without time | 23:59:59 (composer, Quick Entry, title editor) | 12:00 (weekday, "jan 15", "in 3 days"), 23:59:59 ("today") |
| NLP explicit time | parsed, then discarded (D-PARSE-1) | kept (am/pm forms only); no time picker or time display in the UI |
| "!" shortcut | 00:00 | 00:00 |

Effects: a desktop "Tomorrow" task appears in Android's Today. With a default reminder of
"1 hour before", desktop "tomorrow" fires at 23:00 the night before (00:00 convention) or at
22:59 tomorrow (23:59:59 convention); Android fires at 11:00 tomorrow. Sorting within a day
differs too. Canonical proposal: date-only values are stored at local end of day (23:59:59),
explicit times are kept, and Today means "local date ≤ today" on both apps.

**X-4 (P2) Routine history: Android prunes, desktop re-grows.**
Android moves occurrences older than 400 days into a device-local Room archive and records
`prunedBefore` (`RoutineRepositoryImpl.kt:399-412`). Both merges take the union of occurrence
keys and never drop keys older than `prunedBefore` (`RoutineScheduleEngine.kt:128-147`,
`routines.ts:264-286`). The next desktop write therefore re-adds everything Android pruned, the
next Android write prunes it again, and the carrier keeps flapping. Desktop never prunes, so it
hits the 512 KB cap (D-RT-1). Android's 400-day window also reaches the cap first for routines
with 3 or more slots a day (~331 days). The archived history exists on one phone only and is
lost on "Clear cache", logout or reinstall (A-ALARM-4). Canonical: both apps drop occurrences
older than `prunedBefore` during merge, prune on write with a size-aware window (e.g.
`min(400 days, budget / slots)`), and archive to a second carrier task, not device storage.
"After completion" scheduling counts from the scheduled date of the last completed occurrence
in both apps (consistent), but not from the actual completion date the label suggests.

**X-5 (P2) Reminders behave differently and both miss remote changes.**

| | Desktop | Android |
|---|---|---|
| Mechanism | in-memory `setTimeout` (lost on quit, max ~24.8 days) | AlarmManager, persisted, rescheduled on boot |
| Picks up reminders set on the other device | only on init, settings save, resume, or local edit (D-NOTIF-2) | only when the app syncs (open/resume/boot); no periodic sync (A-SYNC-2) |
| Task completed elsewhere | reminder still fires (no refresh on complete) | reminder still fires (A-ALARM-1) |
| Master toggle respected | no (D-NOTIF-1) | yes |
| Actions | none | Mark Complete (toggles; can reopen), Snooze 15 min |
| Relative reminders | uses server-computed `reminder` | server-computed `reminder`, falls back to `due_date` offline |

Canonical: a periodic server refresh on both, re-validating the task at fire time, and an
explicit "complete" action on Android.

**X-6 (P2) Natural-language parsing differs for the same text.**
Both apps share the label, project, priority and recurrence rules (the recurrence mapping is
identical, including monthly = `repeat_mode 1` and "every N months" ≈ N × 30 days). Dates differ
(desktop: chrono-node; Android: a hand-written regex subset). Verified outputs, reference date
Tue 2026-10-06:

| Input | Desktop (chrono, before time override) | Android |
|---|---|---|
| "Call mom next Monday" | Mon 12 Oct, title "Call mom" | Mon 12 Oct 12:00, title "Call mom next" |
| "Meeting today at 14:00" | today 14:00 (then overwritten to 23:59:59) | today 23:59:59, title keeps "at 14:00" |
| "Dentist tomorrow 3:30pm" | tomorrow 15:30 (then overwritten) | tomorrow 12:00, title keeps "3:30pm" (minutes unsupported) |
| "Report 10/15" | 15 Oct | no date |
| "Buy sun cream" | Sun 11 Oct, title "Buy cream" | Sun 11 Oct 12:00, title "Buy cream" |
| "Notes we sat on" / "Plan wed anniversary" | Sat / Wed | Sat / Wed |
| "Water plants daily" | no recurrence (shorthand must be standalone) | same |

Recommendation: keep one shared test corpus (`test-fixtures/` already exists on Android) run by
both test suites. Drop bare three-letter weekday abbreviations unless preceded by "on"/"next" or
followed by a time. Stop overwriting explicit times on desktop. Add "next <weekday>", 24-hour
and minute times to Android.

**X-7 (P2) Review "due" status differs around midnight.** Same footer grammar, cadence math and
14-day default, but desktop computes "today" in UTC (D-REV-2) while Android uses the local date.
For several hours a day the two apps disagree on "reviewed today", "due today" and "overdue".

**X-8 (P3, carried over PAR-1) Inbox ordering.** Desktop: project position order with manual
reordering. Android: `ORDER BY created DESC`, no manual reorder, plus an Android-only "exclude
dated tasks" option.

**X-9 (P3) Search.** Desktop: server `q` search over all tasks (open and done), ranked client-side
over title and description; needs network. Android: local Room `LIKE` on title only (open, or a
variant including done); works offline. The same query returns different results.

**X-10 (P3) Logbook range.** Desktop loads the whole completed history (capped at 1,000 and
truncated by D-REN-1). Android applies a retention window setting.

**X-11 (P3, carried over PAR-4) Today layout.** Desktop separates "Overdue" and "Today" with
project groups inside each. Android shows one project-grouped list.

**X-12 (P3, carried over PAR-7) Year display.** Desktop appends the year for dates outside the
current year; Android never does.

**X-13 (P3) Auth hardening differs.** Android validates the OIDC `state`; desktop doesn't
(D-AUTH-2). Both create a 365-day full-access backup API token, neither revokes it on logout, and
both clean up "sibling" tokens by exact title (desktop: hostname; Android: manufacturer + model).

**X-15 (P3, shared) Recurrence approximations.** Both map "yearly" to 365 days (drifts by a day
in leap years) and "every N months" to N × 30 days. Both hide open subtasks of completed parents
from every list (D-API-4). That's consistent, but such subtasks can only be reached through the
parent.

**X-16 (P2, shared) Labeled subtasks disappear from Tag views.** Both apps remove nested
subtasks before applying the label filter: desktop's `fetchTasks` runs `withoutNestedSubtasks`
on the server result, then TagView filters labels; Android's `toTopLevelTasks()` runs before the
Tag and custom-list filters (A-UI-12). A subtask with label X whose open parent lacks X shows up
in neither app's X view. Filter first, then nest.

**X-17 (P3) Android-only and desktop-only gaps worth closing.** Desktop has no UI for task
relations (related/blocking/precedes...) and no reminder snooze. Android can't open or save
non-image attachments (A-UI-13), has no manual Inbox ordering (X-8), and shows no time of day on
due dates.

---

## 6. Suggested order of work

**Wave 0: security hygiene (hours).**
A-REPO-1 (inspect, purge, rotate), D-SEC-1 (navigation/window-open guards), D-IPC-2 (block
executable attachments), A-NET-1 (no request/debug logging in release), A-BAK-1 (exclude
`vicu_database*` from backup).

**Wave 1: stop losing and corrupting data.**
- Desktop: port Android's `MergePatches` diffing for tasks and projects (D-REN-2, D-PROJ-1,
  D-REV-1, D-SYNC-2); `Buffer.concat` decoding (D-API-1); full pagination (D-REN-1); keep the
  queue on auth/5xx (D-SYNC-1); local-date picker presets (D-DATE-1); atomic config/auth writes
  (D-CFG-1); no partial config on re-login (D-SETUP-1).
- Android: `rememberUpdatedState` in `SwipeableTaskItem` and a due-date-only schedule patch
  (A-UI-1); keep the offline queue across re-login, logout and cache clear (A-UI-2); optimistic
  updates that start from the cached entity (A-DATA-1); a mutex around `performSync` (A-SYNC-1);
  chunked deletes (A-DATA-2); cancel stale alarms, re-check the task at fire time and make the
  action an explicit complete (A-ALARM-1); autosave in task detail (A-UI-3); a day-tick flow for
  routines (A-UI-4).

**Wave 2: one shared definition of the data.**
Write a short cross-app spec with test vectors (same pattern as `description-format-v1.md`) and
implement it in both apps:
custom-list windows (X-1), day boundary and date-only due time (X-3), parser corpus (X-6),
review date math (X-7), routine pruning and merge (X-4). Run the fixtures in both test suites so
the next divergence fails CI.

**Wave 3: reliability and performance.**
Periodic background sync on Android (A-SYNC-2) and periodic reminder refresh on desktop with
the master toggle respected (D-NOTIF-1/2). Cache carrier task ids instead of scanning completed
history (D-NOTIF-3, A-CL-1). Incremental refresh on Android (A-DATA-4). Window-focus refetch on
desktop (D-FRESH-1). Server-side filters for smart lists (D-PERF-2). Cheaper alarm rescheduling
(A-ALARM-2). Streamed attachments (A-ATT-1, D-API-3).

**Wave 4: maintenance.**
Electron patch update (D-DEPS-1), Android CI on push/PR with lint (A-BUILD-1), AGP 9 migration,
release workflow cleanup (D-CI-1), docs drift (D-DOC-1), tracked junk (D-REPO-1, A-REPO-2).

---

## 7. Status of items from the June reviews

Verified fixed since 2026-06-11:

- Android NEW-17 (task lists): Today/Upcoming boundaries now re-evaluate at midnight
  (`endOfTodayFlow`). Routines are still frozen (A-UI-4).
- Android NEW-18: new-task anchor asks for `per_page=1`, `sort_by=position desc`.
- Android NEW-19: create replay checks for a recent server-side duplicate (`findRecentDuplicate`).
- Android PAR-5: "from completion" recurrence label shown.
- Android PAR-6: "!" uses 00:00 on both parser paths.
- Desktop PAR-8: Anytime excludes the inbox (Quick View still doesn't, D-QV-1).
- Android NEW-1: offline edits/deletes of an offline-created task now fold into the queued
  create (`resolveTaskQueueMerge`).
- Android NEW-2: task detail load jobs are cancelled per `loadTask` (stale collectors gone).
- Android NEW-3 / NEW-4 / NEW-5: custom-list "include done", sort and filter-change refresh work.
- Android NEW-6: failed completion rolls back the strikethrough in every list ViewModel.
- Android NEW-7: actions stuck in `processing` are reset at the start of each sync.
- Android NEW-8: snoozes have their own request-code space and survive sync and reboot.
- Android NEW-9: any `IOException` (incl. `SocketException`) counts as offline.
- Android NEW-15: the detail editing session restarts on every open.
- Android swipe follow-ups: edge dead zone, half-way gating and spring-back are done; the dead
  `TaskItem.onSchedule` parameter is gone.

Still open: PAR-1 inbox ordering (X-8), PAR-2 custom-list windows (X-1), PAR-4 Today layout
(X-11), PAR-7 year display (X-12), NEW-14 ignored refresh results (A-UI-14), NEW-16 unescaped
`LIKE` (A-UI-16), NEW-17 only partly fixed (routines still frozen, A-UI-4), toggle success not
written to Room (A-DATA-3), daily summary DST drift (A-SUMMARY-1), no swipe-to-undo on done
rows, no TalkBack path to schedule (A-UI-20). Also new: the collapsed-sections persistence added
in `8a936c3` saves state but never restores it (A-UI-5).
