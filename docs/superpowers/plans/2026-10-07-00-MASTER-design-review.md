# Master plan: implement the 2026-10 design review (desktop + Android)

Source: the design review artifact (https://claude.ai/artifact/1m8FkDABycSyxTbhcPNZ2N, version 2).
Finding IDs: `F-n` shared foundations, `D-n` desktop, `A-n` Android. 45 findings (3 P1, 29 P2,
13 P3) plus the proposal: token contract, smart list identity, redesigned Today, three redesigned
flows, platform polish and the motion system. This plan implements all of it in `vicu` and
`vicu-android`, end to end, with tests, real-app captures and independent validation per wave.

How to use this file:

- The orchestrator (Opus) reads sections 1 to 3 once, then one wave of section 4 at a time.
- A subagent reads section 3 and its own card only. Cards are the briefs; there are no separate
  sub-plans, because code moves under them. Line anchors are from 2026-10-07: grep the symbol if
  one has moved.
- Section 5 lists the end-to-end scenarios, section 6 maps every finding to its cards, section 8 is
  the run log used to resume after a crash.

Paths: desktop paths are relative to `vicu`. Android paths are relative to `vicu-android`, with
`S/` = `shared/src/commonMain/kotlin/com/rendyhd/vicu/`, `T/` = `shared/src/commonTest/kotlin/com/rendyhd/vicu/`,
`APP/` = `app/src/main/java/com/rendyhd/vicu/`.

---

## 1. Decisions

Defaults I will use unless you say otherwise:

| # | Topic | Default |
|---|---|---|
| 1 | Delivery | Branch `design/review-2026-10` in both repos, one commit per card. Both apps release together as 1.10.0. Optional 1.9.1 patch after wave 1 (all three P1s fixed: F-1, F-8, D-1). Push, PRs and tags only on your go-ahead. |
| 2 | Completion hold (F-10) | 5 s on both apps (Android's shipped value), extended while the pointer or keyboard focus is on the row; leaving the view ends it early. Then the row collapses and a toast/snackbar "Completed, Undo" shows for 6 s, merges completions ("3 completed"), pauses on hover/focus. Desktop changes from "until you leave the view". |
| 3 | Android colours (F-2) | The Vicu scheme is the default. "Use device colours" stays in Settings; with it on, status and swipe colours are harmonised to the wallpaper scheme with a small port of material-color-utilities' `Blend.harmonize` in common Kotlin (MDC is not a dependency and is not added). Installs that never touched the switch move to Vicu colours (release note says where the switch is). |
| 4 | Priority mark (F-5) | Linear-style set on both apps, Quick View and widgets: one to three bars for low, medium, high; a filled square with "!" for urgent and do now. Android's "!" text count goes. |
| 5 | Popovers (D-1) | Floating UI positioning (`@floating-ui/dom`, already a dependency) plus the native `popover` attribute for the top layer, light dismiss and Escape. No CSS anchor positioning. Fallback after the spike: a portal with the same positioning. |
| 6 | Search (D-8) | Live "Quick find" at the top of the sidebar (Ctrl+F) and a command palette on Ctrl+Shift+P. No type-to-find. Ctrl+K keeps completing, Ctrl+P keeps printing. |
| 7 | Tailwind (F-1) | Stay on 3.4 with channel variables and `<alpha-value>`. Tailwind 4 later, separately. |
| 8 | Token contract | `test-fixtures/design-tokens-v1.json`, byte-identical in both repos like the other fixtures (same loaders, same discipline; the review suggested `docs/`). Prose in `docs/design-system-v1.md`, also identical. |
| 9 | Date display (F-6) | System locale (region format) on both apps. Clock: Android keeps `LocalIs24Hour`; desktop takes the hour cycle of `app.getSystemLocale()` and adds a Settings choice (System, 12-hour, 24-hour) for an OS custom format Chromium cannot see. One phrasing rule set in `cross-app-semantics-v1.md`; fixtures pin exact strings for en-US and en-GB, built from parts so ICU and java.time agree. |
| 10 | Smart list identity (F-3) | The proposal table, Upcoming keeps the Things red. Identity colours only ever colour list icons. |
| 11 | Sidebar progress (D-9) | Progress ring from a cheap per-project done count: one `done = true`, `per_page=1` request whose API v2 envelope carries `total` (the api-client unwraps and drops it today, so main gets a new count call behind `handleTrusted`), minus the project's known hidden carrier tasks, cached. If `total` is unusable, an open-task count instead. Never a history scan. |
| 12 | Material 3 Expressive | Adopted only if a stable Compose Multiplatform material3 release exposes it. Otherwise the custom `MotionScheme` with the same springs, and the components are deferred and noted. |
| 13 | Windows chrome | `titleBarOverlay` (native caption buttons, Snap Layouts) and Mica behind the sidebar on Windows 11; Windows 10 keeps an opaque sidebar. macOS unchanged; Linux keeps custom controls drawn with tokens. |
| 14 | New dev dependencies | Desktop: `playwright-core` and `axe-core`, verification only. Android app: none (5.3 would upgrade material3 only if Expressive were available, and it is not in 1.4.0). The Android harness gets its own small `scripts/ui-verify/package.json` with `pngjs` for cropping captures. |
| 15 | Reduced motion | Every animation has a reduced variant (cross-fades, no transforms or overshoot). The harness forces full motion for captures because this PC has Windows animation effects off; to see the motion in the real app here, turn on Settings, Accessibility, Visual effects, Animation effects. |

---

## 2. Orchestration

### 2.1 Roles

| Role | Model | Does | Never |
|---|---|---|---|
| Orchestrator | Opus 5.5 (this session) | Decisions, the contract (0.5), dispatch, triage, commits, wave sign-off | Bulk implementation; reading whole large files |
| Implementer | Sonnet 5.5 | Components, Compose UI, motion, logic and its tests | Commits, pushes, edits outside its card |
| Sweeper | Haiku 5.5 | Codemods with explicit patterns, gate runs, captures, docs, version bumps | Design decisions |
| Validator | Sonnet 5.5 | Read-only review of a wave: diff, captures, acceptance lists | Editing |

Every Agent call sets `model` explicitly (`sonnet` or `haiku`); without it a subagent inherits Opus.

Warm agents. Starting an agent costs its system prompt, tool schemas, CLAUDE.md and the plan
preamble before any work (roughly 25k to 35k tokens). So each track keeps one implementer per wave:
the first card starts it, the following cards of that track go to the same agent with
`SendMessage` (it keeps the files it has read). Start a fresh one when its context passes about
120k tokens, when the next card is in unrelated code, or at the end of the wave. Haiku sweeps of
one wave share one Haiku agent the same way. That is about 15 implementer starts instead of 69.

One orchestrator session per wave. The orchestrator is the most expensive context, and it grows
with every report. Run each wave (waves 0 and 1 can share one) in a fresh Opus session that
starts from section 8 of this file, and close the wave with its log entry there.

### 2.2 Dispatch

Brief (at most 12 lines; the card holds the detail):

```
Repo: <absolute path>  Branch: design/review-2026-10
Plan: vicu/docs/superpowers/plans/2026-10-07-00-MASTER-design-review.md. Read only lines
<a-b> (section 3), <c-d> (card <id>) and <e-f> (the section 1 decisions it cites).
If the vicu CLAUDE.md is not already in your context, read it; for vicu-android read its
CLAUDE.md once (a warm agent keeps it).
Values come from test-fixtures/design-tokens-v1.json and docs/design-system-v1.md (from wave 1 on).
Since the card was written: <0-3 lines, e.g. names introduced by earlier cards>
Do not commit. Report in the section 2.2 format.
```

The orchestrator finds the line ranges with `grep -n` on the card headings; the 72 KB plan is
never read whole by a subagent. A follow-up card sent to a warm agent needs only the line range
and the "since" lines.

Report (at most 150 words):

```
STATUS: done | partial | blocked
FILES: path (+added/-removed), ...
TESTS: added or changed test names
GATES: command -> pass/fail (first error only)
CAPTURES: paths
NOTES: deviations, spike results, follow-ups (at most 3 bullets)
```

### 2.3 Branches, concurrency, commits

- Wave 0 creates `design/review-2026-10` from an up-to-date `main` in each repo.
- One writer per repo at a time. Each wave has a desktop track and an Android track that run in
  parallel as two background agents. A second desktop writer is allowed only with
  `isolation: "worktree"` and disjoint files; the orchestrator merges it.
- Capture runs build the app, so they run between cards of their repo, never beside a writer in it.
- The orchestrator re-runs the card gate itself (a background Bash command printing only the last
  lines) and then commits: one commit per card in the repo's style (desktop: a plain sentence;
  Android: `feat(ui): ...`), no emojis, ending with the `Co-Authored-By` line. Then it ticks the
  card here. An implementer's own "gates pass" is never the only evidence.
- Android device safety: every adb and Gradle device command targets the emulator only:
  `adb -s emulator-5554 ...`, `ANDROID_SERIAL=emulator-5554 ./gradlew installDebug`. The wireless
  physical phone is never used.

### 2.4 Gates

| Level | Desktop | Android |
|---|---|---|
| Implementer, while working | `npx vitest run <changed tests>` and `npm run typecheck` | `./gradlew :shared:testAndroidHostTest --tests "<class>" -q` (or `:app:testDebugUnitTest`) |
| Card (before the commit) | `npm run verify` (CLAUDE.md requires it before every commit: it runs the code-splitting and `handleTrusted` guards too) | `./gradlew test assembleDebug -q` (KoinGraphTest is part of `test`; run it after any DI change) |
| Wave | `npm run verify`; `npm run ui:verify -- --wave N` in light and dark (axe from wave 3) | `./gradlew test lint assembleDebug`; install on emulator-5554; `node scripts/ui-verify/shots.mjs --wave N` in light and dark, plus `a11y.mjs` |
| Final | Section 5 | Section 5 |

A failing gate is never committed.

### 2.5 Validation loop (every wave)

1. Haiku runs both wave gates and the wave's captures; it returns failures only, plus capture paths.
2. Two Sonnet validators in parallel, one per repo, read-only. Input: the wave's card IDs, the
   commit range, the file `git diff <range> -- . ':!**/__tests__/**' ':!**/tokens.css'` written
   to the scratchpad, at most 10 captures (cropped with the harness `clip`) and the matching
   baseline captures. They check every Accept line and the section 3 rules from that diff and
   those images, opening other files only to confirm a suspected problem, in at most 30 tool
   calls (the open-ended plan check took 91 calls and about 295k tokens; a bounded wave check
   should stay well under a third of that). Output: PASS/FAIL per card with one line of evidence,
   then at most 10 ranked issues. After waves 2 and 4 the Android validator also gets the paired
   desktop captures of the same screens (Today, Upcoming, an open task, quick add, the When
   picker) and checks cross-app agreement: anatomy, headers, priority marks, date phrasing,
   identity, completion behaviour.
   Waves 0 and 5 get no separate validator: the orchestrator checks wave 0's harness output, and
   wave 5 is covered by wave 6.
3. The orchestrator turns failures into fix cards (`<id>-fix1`), dispatches them and re-gates.
   Two fix cycles at most per wave; anything left goes to section 7 and into the final report.
4. Sign-off: a five-line entry in section 8.

### 2.6 Token budget

- The orchestrator reads `git diff --stat`, gate summaries and reports; it opens hunks only for a
  failure or a validator flag, and never reads a file over 300 lines whole.
- Subagents get file paths and anchors in their card, so they do not search broadly.
- Test output in dot or quiet mode; reports quote the first failure only.
- Captures at device scale 1, cropped to the region under test; at most 10 per validator.
- Anything with an exact recipe (codemod pattern lists, captures, docs, version bumps) goes to Haiku.
- The orchestrator runs gates as background commands that print only the result lines
  (`npm run verify 2>&1 | grep -E "Test Files|Tests |error TS|FAIL" | head`,
  `./gradlew test assembleDebug -q 2>&1 | tail -15`), and waits for the notification instead of
  polling.
- Every subagent report stays in the orchestrator's context for the rest of the wave, which is
  why reports are capped at 150 words and gate output at its first failure.
- A card that fails its gate twice goes to a fresh Sonnet with the failure summary. A third
  failure comes back to Opus.

### 2.7 Crash and resume

State is the checkboxes here, `git log main..design/review-2026-10` in both repos and section 8.
After a crash: read section 8, compare with both git logs, look at `git status` of both repos. An
interrupted card whose diff looks complete is gated and committed; otherwise its edits are
discarded (after looking at them) and the card restarts. Agent IDs from before a crash are gone.

---

## 3. Rules for every card

1. Read the repo's CLAUDE.md. Desktop: shared modules in `src/shared` stay free of DOM and
   Electron; IPC handlers via `handleTrusted`; every task write is a merge patch (a completion is
   `{ done: true }`, an undo `{ done: false }`, clearing a date `due_date: null`). Android: time
   from `TimeSource`, the day from `DayClock`; snackbars through `AppMessages`.
2. Colours, type sizes, radii, durations and easings come from the tokens: desktop CSS variables
   and Tailwind role classes generated from `test-fixtures/design-tokens-v1.json`; Android
   `MaterialTheme`, `LocalVicuColors` and `VicuMotion`. No new raw hex, pixel font sizes or
   millisecond values in components. Guard tests enforce part of this.
3. Every animation has a reduced variant. Desktop: under `prefers-reduced-motion: reduce`, fades
   only (no transform, no height animation, no overshoot), via the CSS base layer or
   `useReducedMotion()`. Android: Compose animations follow the system animator scale; custom
   `Animatable` loops must also end correctly at scale 0.
4. Accessibility: every control has a name, checkboxes expose role and state, targets are at least
   24 px on desktop and 48 dp on Android, focus is visible, colour never carries meaning alone.
5. Logic is test-first (formatters, state machines, colour derivation, grouping, token drift).
   UI is verified through the harness.
6. Keep the diff to the card. Out-of-scope issues go in NOTES.
7. No emojis in code, strings, comments, docs or commits.
8. `test-fixtures/*`, `docs/cross-app-semantics-v1.md` and `docs/design-system-v1.md` change only
   in cards that say so, and then identically in both repos.
9. Never print credentials. Test credentials and tokens live in `scripts/ui-verify/.local/`
   (gitignored).
10. Android device commands only against `emulator-5554`.
11. Keep each file's existing line endings (many Android files are CRLF or mixed, and Android has
    no `.gitattributes`). A `git diff --stat` that rewrites a whole file you only touched in a few
    places means the endings flipped: fix that before reporting.

---

## 4. Waves

| Wave | Theme | Desktop track | Android track | After |
|---|---|---|---|---|
| 0 | Setup, harness, contract | 0.1, 0.2a, 0.2b, 0.4, 0.5 | 0.3 | - |
| 1 | Foundations and the P1 fixes | 1.1, 1.1b, 1.2, 1.3, 1.4, 1.4b, 1.5 | 1.6a, 1.6b, 1.6c, 1.7, 1.7b, 1.8, 1.9 | 0 |
| 2 | Shared components, row anatomy | 2.1a to 2.9a | 2.1b to 2.9b | 1 |
| 3 | Interaction, accessibility, the clunky flows | 3.1, 3.2a to 3.2c, 3.3, 3.4a1, 3.4a2, 3.5, 3.8, 3.9a, 3.10 to 3.12 | 3.4b, 3.6, 3.7, 3.9b | 2 |
| 4 | Motion | 4.1, 4.2a to 4.2c, 4.4, 4.6, 4.8, 4.11a | 4.3, 4.5a, 4.5b, 4.7, 4.9, 4.10, 4.11b | 3 |
| 5 | Platform polish | 5.1, 5.2 | 5.3 | 4 (one desktop writer at a time, so 5.1 and 5.2 follow the wave 4 desktop track) |
| 6 | Verification, docs, release prep | 6.1 to 6.6 | 6.1 to 6.6 | 5 |

### Wave 0: setup, harness, contract

- [x] **0.1 Branches and a clean test run** · both · Haiku
  State on 2026-10-08: the parser task is merged (desktop PR #36, Android PR #31). Local `main` in
  both repos is one unpushed commit ahead of `origin/main` ("Make routines optional and keep
  finished ones out of Today"); decided: it rides along on the design branch. The two leftover
  worktrees were removed on 2026-10-08 (the desktop one leaves an empty folder that another
  process still had open; delete it when it is free).
  - Fetch, then create `design/review-2026-10` from local `main` in both repos (desktop has
    untracked docs: leave them alone). Report both HEADs.
  - Desktop `vitest.config.ts`: add `'**/.claude/**'` to `exclude`. Without it vitest also runs
    the tests inside any `.claude/worktrees/` copy (254 files instead of 127), and the doubled
    load made `offline-queue.test.ts` "keeps the log bounded" time out on 2026-10-08. The
    plan's own `isolation: "worktree"` agents would trigger the same doubling. First commit.
  Accept: `npm run verify` green with 127 test files; Android `./gradlew test lint assembleDebug`
  green (it was on 2026-10-08).

- [x] **0.2a Test server, seed, profiles** · desk · Sonnet
  Port the review's scripts (in the review session's scratchpad,
  `C:\Users\rendy\AppData\Local\Temp\claude\C--Users-rendy-vscode-vicu\3a16467f-88de-4e89-9191-d8c2c3a552ce\scratchpad`:
  `seed.mjs`, `make-token.mjs`, `desk-shots.mjs`, `steps.cjs`, `springs.mjs`, `contrast2.mjs`;
  write them fresh from this spec if that folder is gone) into `scripts/ui-verify/`:
  - `README.md` with the server recipe (Git Bash): `export MSYS_NO_PATHCONV=1`, then
    `docker run -d --name vicu-test-vikunja -p 127.0.0.1:3456:3456 -e VIKUNJA_SERVICE_PUBLICURL=http://localhost:3456/ -e VIKUNJA_SERVICE_SECRET=<random> -e VIKUNJA_FILES_BASEPATH=/tmp/files -e VIKUNJA_DATABASE_PATH=/tmp/vikunja.db -e VIKUNJA_SERVICE_ENABLEREGISTRATION=false vikunja/vikunja:2.4.0`;
    users via `docker exec vicu-test-vikunja /app/vikunja/vikunja user create ...`; API at
    `http://127.0.0.1:3456/api/v2`.
  - `seed.mjs`: the review dataset (areas Work and Personal with child projects, labels in
    Vikunja's preset colours, overdue, today, timed, upcoming, undated, repeating, checklist,
    reminder and done tasks, reviewable projects). Credentials and the API token in `.local/`.
  - `profile.mjs`: writes `VICU_USER_DATA_DIR` profiles (light, dark) that use the API token.
  - `.gitignore` for `scripts/ui-verify/.local/` and `scripts/ui-verify/out/`.
  Accept: from an empty Docker state, the README steps plus `seed.mjs` and `profile.mjs` give a
  seeded server and two profiles; nothing secret is printed or tracked.

- [x] **0.2b Desktop harness and scenarios** · desk · Sonnet
  - `desktop.mjs`: `playwright-core` `_electron` launch of the built app
    (`node_modules/electron/dist/electron.exe .`, after `npm run build`). Options `--theme`,
    `--size WxH`, `--motion full|reduce`, `--forced-colors`, `--scenario a,b`, `--wave N`.
    Helpers: `goto(route)`, `click(textOrSelector)`, `key`, `type`, `hover`, `drag`, `wait`,
    `capture(name, { clip })`, `assert(label, fn)`, `axe(selector?)`, `api(method, path)` (reads
    the server to check what was saved), `frames(ms)` (rAF timing sample). One JSON line per
    assertion; captures to `scripts/ui-verify/out/<run>/` at device scale 1. Always
    `emulateMedia({ reducedMotion: 'no-preference' })` unless `--motion reduce`.
  - `scenarios/<name>.mjs`, one per scenario; `baseline` covers Inbox, Today, Upcoming, Anytime,
    Logbook, Review, Routines, Settings, a project, a tag, an open card, the date popover on the
    last Today row, the composer with parsed text, the context menu, Quick Entry, Quick View.
    `--wave N` runs the scenarios a wave lists in section 5.
  - Scenario dates are computed from the run date (the seed is relative to today), never
    hard-coded.
  - devDependencies `playwright-core`, `axe-core`; npm script `ui:verify` (`electron-builder.yml`
    does not package `scripts/`).
  Accept: `npm run ui:verify -- --scenario baseline` in light and dark gives 16 captures each, no
  errors; `npm run verify` unchanged.

- [x] **0.3 Android UI harness** · droid · Sonnet
  Port `droid.mjs` and `droid-shots.mjs` from the same scratchpad into `scripts/ui-verify/`:
  - adb is not on PATH here: use `sdk.dir` from `local.properties`
    (`C:\Users\rendy\AppData\Local\Android\Sdk`) plus `platform-tools/adb.exe`. The review ran
    on the `Pixel_10` AVD (`emulator/emulator.exe -avd Pixel_10`), which comes up as emulator-5554.
  - `droid.mjs`: adb helpers with the serial fixed to `emulator-5554` (abort unless
    `adb -s emulator-5554 get-state` prints `device`; no adb call without `-s`): tap, swipe,
    `motionevent` (hold a gesture mid-way), text input, `dump()` (uiautomator XML to nodes with
    bounds, text, content-desc, checkable, checked, clickable), `shot(name, clip?)` (cropping with
    `pngjs` from a small `scripts/ui-verify/package.json`), `night(on)`, `fontScale(x)`,
    `animScale(x)` (mid-animation captures run at animator scale 5 to 10 instead of screen
    recording).
  - `login.mjs`: sets up the debug app against `http://10.0.2.2:3456` with the API token from
    `../vicu/scripts/ui-verify/.local/` (path argument), typed through adb, never printed.
  - `shots.mjs`: `--scenario`, `--wave`, `--theme`; `baseline` = Inbox, Today, Upcoming, Anytime,
    drawer, project, tag, Logbook, Review, Settings, task editor, quick add with parsed text,
    date picker, swipe partial and armed, search.
  - `a11y.mjs`: from a dump, report clickable nodes without text or content-desc, task checkboxes
    whose content-desc lacks the task title or that are not checkable, and targets under 48 dp
    (pixels divided by the `wm density` scale).
  Accept: baseline in light and dark on emulator-5554 runs clean (a11y findings are reported,
  not fatal, in wave 0).

- [x] **0.4 Baseline captures** · both · Haiku
  Start the server (the container `vicu-test-vikunja` already exists: `docker start
  vicu-test-vikunja`; re-seed only if its data is gone), boot the `Pixel_10` AVD, seed, build both
  apps, install the debug APK on emulator-5554, log in, run both baselines in light and dark into
  `out/baseline/`. Report counts and harness errors. These are the
  "before" images for every validator.

- [x] **0.5 The contract** · both · Sonnet writes, Opus reviews
  Sonnet generates the files below from this card; Opus reviews the contrast output, the
  generated M3 schemes and the two docs before the commit. Values in the table were adjusted from
  the review so every pair in the `contrast` list passes (light text.secondary, priority medium
  and high; dark accent, overdue, text.secondary and hover); the generator must still prove it.
  Identical in both repos, in one commit each:
  1. `test-fixtures/design-tokens-v1.json`. Role names are dotted (`text.secondary`); the
     desktop CSS name is `--` plus dashes, except the legacy aliases listed under `css`. Content:

     | Role | Light | Dark | Notes |
     |---|---|---|---|
     | bg.page | #FFFFFF | #1C1C1E | css `--bg-primary` |
     | bg.sidebar | #F5F5F7 | #2C2C2E | macOS keeps its translucent override |
     | bg.card | #FFFFFF | #2A2A2D | dark adds a 1 px highlight, #FFFFFF at 8%, no shadow |
     | bg.hover | #F2F2F7 | #323234 | dark was #3A3A3C (accent text failed on it) |
     | bg.selected | #E8F0FE | #1C3049 | |
     | border | #E5E5EA | #38383A | separators only, never a control boundary |
     | text | #1D1D1F | #F5F5F7 | css `--text-primary` |
     | text.secondary | #636366 | #AEAEB2 | 5.2:1 or more on every surface |
     | text.tertiary | #AEAEB2 | #636366 | disabled and decoration only, never readable text; placeholders use text.secondary |
     | control.ring | #8E8E93 | #7C7C80 | checkbox and radio rings |
     | accent | #0A66D1 | #6AACFF | links and accent text; css `--accent-blue` |
     | accent.fill | #0A66D1 | #0A66D1 | filled buttons, checked checkbox |
     | on.accent | #FFFFFF | #FFFFFF | 5.48:1 on accent.fill |
     | focus.ring | #0A66D1 | #6AACFF | |
     | status.overdue | #D70015 | #FF7B73 | |
     | status.today | #C2410C | #FFB340 | |
     | status.done | #1E7D34 | #30D158 | |
     | danger | #D70015 | #FF7B73 | delete, clear date |
     | priority.low / medium / high / urgent | #0066CC / #8A5F00 / #A74A09 / #D70015 | #6AACFF / #FFD60A / #FF9F0A / #FF7B73 | urgent covers 4 and 5 |
     | palette.* | current `--accent-red` ... `--accent-teal` | current | icons only |

     `bg.sidebar` keeps its raw `var()` form on the platforms with a translucent override
     (`index.css:46-52`, `AppShell.tsx:664`): it never gets a channel variable or an opacity class.

     - `contrast`: pairs to assert per theme, at least: text, text.secondary, accent,
       status.overdue, status.today, status.done, each priority role on bg.page, bg.sidebar,
       bg.card, bg.hover and bg.selected at 4.5:1; on.accent on accent.fill at 4.5:1;
       control.ring and focus.ring on bg.page and bg.card at 3:1; status.overdue on its own 8%
       tint over bg.page at 4.5:1.
     - `labelChip`: `tintAlpha` 0.12, text 11 px / 600, `minContrast` 4.5, the derivation (keep
       hue and saturation in HSL; step lightness by 1% darker in light mode, lighter in dark mode,
       from the label colour, until the text passes on the tint composited over bg.page; round
       channels once at the end) and `vectors` for Vikunja's preset label colours (check the
       list in Vikunja's frontend colour picker) in both themes, plus the review's `#5AC8FA`
       ("call", light expected near #0B6B94).
     - `priority`: level to mark (`bars-1`, `bars-2`, `bars-3`, `square-bang` for 4 and 5) and role.
     - `identity`: inbox #0A84FF Inbox / Outlined.Inbox; today #E8A400 Sun / Outlined.WbSunny;
       upcoming #E5484D CalendarDays / Outlined.CalendarMonth; anytime #14A3A3 Layers /
       Outlined.Layers; routines #E5487A HeartPulse / Outlined.MonitorHeart; review #8E55E8
       RefreshCw / Outlined.Autorenew; logbook #2E9D58 CircleCheckBig / Outlined.CheckCircle.
     - `type`: pageTitle 26/700 (Android 28 sp bold, large top app bar), section 13/600 with a
       count (titleSmall), group 12/600 with a dot (labelMedium), taskTitle 14/400 line 20
       (bodyLarge 16 sp), cardTitle 15/600, meta 12/500 (labelMedium 12 sp), chip and caption
       11/600 (labelSmall 11 sp). Nothing below 11.
     - `radius`: control 6 px / 8 dp, popover and menu 10 px / 12 dp, card 12 / 12, sheet - / 28 dp,
       chip full on both.
     - `motion`: fade.fast 150 ms `cubic-bezier(0.2, 0, 0, 1)` (Android spring 1.0 / 3800);
       fade.base 240 ms, enter `cubic-bezier(0.05, 0.7, 0.1, 1)`, exit `cubic-bezier(0.3, 0, 0.8, 0.15)`
       (1.0 / 1600); move spring 0.9 / 700, CSS 320 ms; move.expressive 0.8 / 380, CSS 440 ms;
       pop 0.6 / 800, CSS 360 ms; page 90 ms out, 210 ms in, 6 px rise; stagger 35 ms, at most 5
       items; keyboard-driven moves at most 120 ms; check draw 220 ms; strike draw 240 ms.
       `motionScheme` (all six Compose slots): fastSpatial 0.6 / 800 (pop), defaultSpatial
       0.9 / 700 (move), slowSpatial 0.9 / 300, fastEffects 1.0 / 3800, defaultEffects 1.0 / 1600,
       slowEffects 1.0 / 800.
     - `android`: `colorScheme.light` and `.dark`, every M3 role, generated once from the seed
       #0A66D1 with material-color-utilities (npm, in a scratch folder, not committed; fidelity
       variant so primary stays near the seed); `custom` dueToday #9A4600 / #FFB870, done,
       swipeComplete (green) and swipeSchedule (amber) with container and on colours that pass
       4.5:1; `statusMap` status.overdue -> `error`, status.today -> `custom.dueToday`.
  2. `docs/design-system-v1.md`: the roles in prose (which colour for what, never identity
     colours for text, labels never read as status), the chip derivation, priority marks, row
     anatomy, section and page headers, motion tokens and the motion moments, reduced motion, the
     haptics map (`GestureThresholdActivate` swipe commit, `ToggleOn` completing, `Confirm` bulk
     actions, `SegmentFrequentTick` reorder steps). Link it from both CLAUDE.md files.
  3. `docs/cross-app-semantics-v1.md` gets "Completion hold" and "Date display";
     `test-fixtures/cross-app-semantics-v1.json` gets `completion` (constants plus event-sequence
     vectors: complete, hoverStart, hoverEnd, focusIn, focusOut, navigate, undo at times, with the
     expected held rows, collapsed rows and toast text at given times) and `dateDisplay` (now,
     zone, locale en-US or en-GB, hour12, due, dateOnly, context, expected text). Contexts:
     - `row`: overdue "Yesterday", "3 days ago" (2 to 6), then the date; today "Today" (a time
       if set); tomorrow "Tomorrow"; within 6 days the short weekday "Fri"; later "18 Oct" or
       "Oct 18"; the year only when not the current one; a set time appended in the user's clock.
     - `row.inToday`: like `row`, but today's date-only tasks show nothing and timed ones the time.
     - `row.inDayGroup`: the time only, if any.
     - `chip`: always the day, "Sat 10 Oct, 15:00" or "Sat, Oct 10, 3:00 PM".
     - `header.day`: "Tomorrow", within 6 days "Fri 9", later "Mon 12 Oct" or "Mon, Oct 12".
     - `header.full`: "Wednesday 7 October" or "Wednesday, October 7".
     - `logbook.group`: "Today", "Yesterday", within 6 days "Mon 5 Oct", older the month and
       year ("September 2026"); `logbook.time`: the completion time.
  4. A local identity test in each repo (vitest; JVM test): when the sibling repo exists next to
     it, the shared fixtures and docs are identical after normalising line endings; skipped
     otherwise. Pair the files explicitly: Android keeps `custom-list-sync-v1.json` in
     `shared/src/commonTest/resources/`, not in `test-fixtures/`.
  Accept: both full gates green (no consumers yet besides the identity test).

### Wave 1: foundations and the P1 fixes

Desktop track: 1.1, 1.1b, 1.2, 1.3, 1.4, 1.4b, 1.5. Android track: 1.6a, 1.6b, 1.6c, 1.7, 1.7b,
1.8, 1.9.

- [x] **1.1 Token pipeline and the tint fix (F-1, F-7, F-8)** · desk · Sonnet
  - `scripts/gen-tokens.mjs` (npm script `tokens`) reads the token file and writes
    `src/renderer/assets/tokens.css` (generated, "do not edit" header): each colour role as a hex
    var and an `-rgb` channel var (`--accent-blue-rgb: 10 102 209`), light in `:root`, dark in
    `.dark`; type, radius and motion vars (`--ease-standard`, `--dur-pop: 360ms`,
    `--spring-pop: linear(...)`). Spring curves come from damping and stiffness (port
    `springs.mjs`: simulate to the CSS duration, 40 to 60 points, last point exactly 1).
  - `src/renderer/assets/index.css` imports `tokens.css` and keeps only non-token rules; legacy
    names stay as aliases so nothing breaks before 1.2.
  - `tailwind.config.ts`: colours from the token file as `rgb(var(--x-rgb) / <alpha-value>)`
    (roles plus the legacy palette names), `fontSize` roles (caption, meta, body, title,
    page), `borderRadius` roles (control, popover, card, chip).
  - Tests: `tokens.test.ts` (tokens.css equals a fresh generation; token file shape) and
    `contrast.test.ts` (every `contrast` pair in both themes, WCAG relative luminance, alpha
    composited).
  - `bg-sidebar` stays a raw `var(--bg-sidebar)` colour (no channel var, no opacity use), so the
    macOS vibrancy override and the 5.1 Mica rule keep working.
  - Write `scripts/ui-verify/tailwind-sweep.md` for 1.1b: the exact before/after patterns for the
    roughly 104 broken classes in 27 files, and the rule for the guard test.
  Accept: both tests pass; the built CSS contains `bg-accent-blue/15` and
  `hover:bg-accent-blue/90` rules.

- [x] **1.1b Class sweep and guard** · desk · Haiku
  Apply the patterns in `tailwind-sweep.md` (e.g. `bg-[var(--accent-blue)]/15` to
  `bg-accent-blue/15`, `placeholder:text-[var(--text-secondary)]/50` to
  `placeholder:text-text-secondary/50`), then add `tailwind-classes.test.ts` (source scan of
  `src/renderer`: no `[var(--x)]/N`; `<colour>/N` only for colours declared with
  `<alpha-value>`; N on the configured opacity scale, e.g. `TaskRow.tsx:496` `/8`). No other edits.
  Accept: the guard passes; a selected row shows a fill in the capture.

- [x] **1.2 Role colours in use (F-8, F-4, D-11)** · desk · Sonnet
  - `TaskDueBadge.tsx:22-23`: due today, overdue and scheduled roles (scheduled = text.secondary);
    a tint chip only for overdue (8%); everything else coloured text.
  - `TaskCheckbox.tsx`: ring control.ring, checked fill accent.fill.
  - Primary buttons accent.fill with on.accent in both themes (white on the dark `#4C9BFF` fails);
    secondary text role; error and warning boxes and the error toast border on status roles.
  - Red is split by role: status.overdue on dates, danger on delete and "Clear date",
    priority.urgent only inside the mark.
  - Quick Entry and Quick View import `tokens.css` (their Vite entries) and replace hand-written
    colours in `quick-entry/styles.css` and `quick-view/viewer.css:325-342` (today #D69E2E, overdue
    #E53E3E, green upcoming #38A169) with roles; upcoming is text.secondary.
  Accept: no `#FF9500|#FF3B30|#007AFF|#D69E2E|#E53E3E|#38A169|#EF4444|#F97316` in renderer sources
  outside generated tokens; captures of Today, Upcoming, Quick View and Quick Entry, light and dark.

- [x] **1.3 Popover primitive; pickers stay on screen (D-1)** · desk · Sonnet
  - `components/overlay/Popover.tsx` and `use-floating-popover.ts`: native `popover` (top layer;
    `auto` with light dismiss and Escape, `manual` where nesting needs it), positioned with
    `computePosition` and `autoUpdate` from `@floating-ui/dom`: `offset(6)`, `flip`,
    `shift({ padding: 8 })`, `size` (max height = available space, inner scroll), strategy
    `fixed`. Props: anchor ref, placement, role (`dialog` | `listbox` | `menu`), initial focus,
    `onClose`. Focus returns to the anchor on close. React 18 does not know the toggle events:
    attach `toggle`/`beforetoggle` with `addEventListener`. `@types/react` 18.3 types `popover`
    only in `canary.d.ts`: add `/// <reference types="react/canary" />` in one `.d.ts`.
  - Spike first, results in NOTES: a picker inside the open card, a nested popover (label create
    inside the label picker), a picker in a dnd-kit sortable row, inside the scrolling list, at
    1280x820 and 900x600. If the native popover misbehaves, use a portal into `#overlay-root` with
    the same positioning and manual dismissal.
  - Migrate all nine pickers (Date, Reminder, Priority, Label, DraftLabel, Project, Recurrence,
    Attachment, Info) and delete `use-popover-alignment.ts`. Entrance motion is 4.1.
  Accept: scenario `popover-edge`: Schedule on the last Today row at 1280x820 and 900x600 keeps
  the popover inside the window (flipped above; inner scroll at 600 px); Escape closes it and
  focus returns to the toolbar button; all nine open and close by mouse and keyboard.

- [x] **1.4 Small fixes (D-11, D-19, D-21, F-7 type)** · desk · Haiku
  - D-11: in both quick windows, `font: inherit` on `#task-input` and every form control, so the
    highlight layer lines up.
  - D-21: `ToastHost.tsx:9` always renders the `aria-live="polite"` region, empty when idle.
  - D-19: `EmptyState.tsx:17` subtitle in text.secondary without opacity.
  - F-7: every `text-[10px]`, `text-2xs` and size under 11 px becomes a role class (dates use
    meta 12); guard test: no font size under 11 px, no arbitrary `text-[Npx]` outside an allowlist.
  Accept: guard test passes; captures of Quick Entry with parsed text (highlights aligned) and an
  empty list.

- [x] **1.4b Review state, radii, tertiary text (D-13, F-7 shape, F-8)** · desk · Sonnet
  - D-13: Review's "Never reviewed" becomes a grey "Not reviewed yet" (text.secondary); overdue
    reviews an amber "Due" (status.today); projects as colour dots.
  - F-7: move the roughly 198 `rounded-*` uses onto the radius roles by element type (controls,
    popovers and menus, cards, chips); guard test: no arbitrary `rounded-[...]`.
  - F-8: the 9 uses of text.tertiary on readable text move to text.secondary (tertiary stays for
    disabled and decorative only).
  Accept: guard passes; captures of Review, a popover, an open card.

- [x] **1.5 Focus, targets, reduced motion base (D-20, accessibility)** · desk · Sonnet
  - One `:focus-visible` ring (2 px focus.ring, 2 px offset, inset inside rows) for buttons, links,
    inputs and rows; remove conflicting ad-hoc focus borders.
  - Checkbox: 20 px visual in a 24 px hit area (pseudo-element); the 12 px attachment button and
    the subtask toggle get 24 px hit areas; toolbar buttons at least 28 px.
  - Reduced-motion base layer: under `prefers-reduced-motion: reduce`, no transform, size or
    position transitions; colour and opacity transitions at most fade.fast. `useReducedMotion()`
    hook (matchMedia, live) for later JS motion.
  Accept: scenario `keyboard-tab` (ring on every stop in Today); a hit-area assertion
  (`elementFromPoint` 11 px from the checkbox centre returns the checkbox).

- [x] **1.6a VicuTheme: schemes, type, shapes, default (F-2, F-8)** · droid · Sonnet
  Files: `S/ui/theme/Color.kt`, `Theme.kt`, `Type.kt`, new `Shape.kt`; `S/data/local/ThemePrefsStore.kt`.
  - Full light and dark `ColorScheme` from `android.colorScheme` (every role).
  - Typography and Shapes from the token roles (small 8, medium 12, large 12, extraLarge 28;
    chips use a full pill on the chip itself). Remove the template comments.
  - Dynamic colour default off when the key is absent; the Settings switch reads "Use device
    colours" with a one-line summary.
  - Tests in `T/ui/theme/`: `DesignTokensTest` (schemes, type, shapes equal the token file, loaded
    with `CrossAppFixture`), `AndroidContrastTest` (onSurface and onSurfaceVariant on surface and
    the surfaceContainer roles, error on surface and on an 8% error tint).
  Accept: tests pass; captures light and dark, device colours off and on.

- [x] **1.6b VicuMotion and LocalVicuColors (F-4)** · droid · Sonnet
  - `Motion.kt`: `VicuMotion : MotionScheme` with the six `motionScheme` specs from the token
    file, passed as `MaterialTheme(motionScheme = VicuMotion)` (the factories are internal in
    material3 1.4.0).
  - `VicuColors.kt`: `LocalVicuColors` with dueToday, done, swipeComplete and swipeSchedule (with
    containers and on colours), priority 1 to 4, identity. Overdue stays `colorScheme.error`.
  - Extend `DesignTokensTest` (motion constants, custom colours, identity) and
    `AndroidContrastTest` (dueToday on surface, the swipe and priority pairs).

- [x] **1.6c Harmonised custom colours** · droid · Sonnet
  Port material-color-utilities' `Blend.harmonize` with the HCT pieces it needs (Apache 2.0,
  attribution in the file header) to common Kotlin under `S/ui/theme/color/`; generate test
  vectors once with the npm package in a scratch folder and commit only the vectors (an
  Android-only test resource). With device colours on, `LocalVicuColors` uses harmonised values.
  Accept: vectors match; captures with device colours on.

- [x] **1.7 Android role colours in use (F-8, F-4, A-12)** · droid · Sonnet
  - `TaskItem.kt:603-609`: the due chip loses its hard-coded #EF4444 and #F97316; due today is
    dueToday text with no chip, overdue is `colorScheme.error` on an 8% error tint; upcoming in
    onSurfaceVariant.
  - A-12: `TodayScreen.kt:270-273` and `CollapsibleSection.kt:79-83`: header text in
    onSurfaceVariant with an 8 dp project colour dot; the Overdue title in `colorScheme.error`.
  - Grep the Android sources for other hard-coded status and priority hex values and move them
    onto roles.
  Accept: no `Color(0xFFEF4444)`-style status literals outside `S/ui/theme`; captures of Today
  in light and dark.

- [x] **1.7b Android small fixes (A-3, A-11)** · droid · Haiku
  - A-3: `contentPadding = PaddingValues(bottom = FabClearance)` (88 dp, one constant) on every task
    list: Today, Inbox, Upcoming, Anytime, Project, Tag, CustomList, Logbook, Search, area views.
  - A-11: no search action on Settings.
  Accept: captures of the bottom of Today and Anytime (last row clear of the FAB) and Settings.

- [x] **1.8 Upcoming by day (A-2)** · droid · Sonnet
  `S/ui/screens/upcoming/UpcomingViewModel.kt:59` and `UpcomingScreen.kt`: groups by local day from
  `DayClock`, sticky headers (`stickyHeader`), ordered by due time then position; labels from a
  temporary function until 2.1b supplies `header.day`. Tests: grouping across midnight and DST,
  empty days skipped, ordering.
  Accept: the capture groups the seed data the same way desktop does.

- [x] **1.9 Notification permission in context (A-10)** · droid · Sonnet
  Remove the first-launch request (`APP/MainActivity.kt:72`). Ask after setup completes, behind a
  one-sentence rationale sheet, or the first time a reminder or the daily summary is turned on.
  Settings shows the state and opens the system page when denied. Decision logic in a small
  policy class with JVM tests (requests left, rationale state).
  Accept: on emulator-5554, `pm clear com.rendyhd.vicu.debug`, launch: no prompt before setup; the
  sheet and then the prompt after setup.

### Wave 2: shared components and row anatomy

Desktop track: 2.1a, 2.2a, 2.3a, 2.4a, 2.5a, 2.6a, 2.6c, 2.7, 2.8, 2.9a.
Android track: 2.1b, 2.2b, 2.3b, 2.4b, 2.5b, 2.6b, 2.9b.

- [x] **2.1 Date display (F-6)** · a desk Sonnet · b droid Sonnet
  a) `src/shared/date-display.ts` (pure; locale and hour cycle passed in) implements every
  contract context; tests run the `dateDisplay` vectors in both TZ suites. There is no explicit
  12/24 h rule today (it is implicit in `toLocaleTimeString(undefined)` at `date-utils.ts:49` and
  `quick-view/viewer.ts:213`, with hard-coded en-US and `hour12: true` at `date-utils.ts:33-43,70-73`
  and `TodayView.tsx:87`). Implement decision 9: main sends `app.getSystemLocale()` and the hour
  cycle (Settings: System, 12-hour, 24-hour; System = the locale's hour cycle) to all three
  windows. Replace every place above plus `NewTaskComposer.tsx:77`, `ReminderPickerPopover.tsx:92`,
  the fixed "Tomorrow 9 AM", Logbook dates and Quick View's phrasing. Today's PageHeader subtitle
  uses `header.full`.
  b) `S/util/DateDisplay.kt` with `Locale` and the existing `LocalIs24Hour` (`Is24Hour.kt`; commonMain
  already uses java.time, so no new expect/actual), the same vectors. It replaces
  `DateUtils.kt:103-112` (`formatRelativeDate`, used by `ParseChipRow.kt` `formatDateChip`), the
  TaskItem chips, Logbook, widgets and the Upcoming headers from 1.8.
  Accept: vectors green in both; no raw ISO dates in UI text (grep); composer and quick-add chips
  read "Sat 10 Oct, 15:00" style; the desktop clock setting switches every window.

- [x] **2.2 Priority mark (F-5)** · a desk Sonnet · b droid Sonnet
  Shapes from the token file, colour from the priority roles, accessible name "Priority: High",
  placed last in the meta cluster.
  a) `components/shared/PriorityMark.tsx` (inline SVG, 14 px) replaces `PriorityDot.tsx` in rows,
  the card, the context menu and the pickers; priority 5 now draws. Quick View uses the same
  markup from `src/shared/priority-mark-svg.ts`. Quick Entry chips show the parsed value in its own
  priority colour; token highlights keep the parser's type colours.
  b) `PriorityMark` composable (Canvas) replaces the "!" text in `TaskItem.kt`;
  `TaskRowSemantics.kt` names stay; widgets get vector drawables of the same shapes.
  Accept: captures with all five levels in both apps; names in the a11y dump.

- [x] **2.3 Label chips (F-9, A-1)** · a desk Sonnet · b droid Sonnet
  The contract derivation (text tone from the label hue), 12% tint, 11/600 text, full pill, no
  border. Both run `labelChip.vectors`. a) `lib/label-style.ts:17`. b) `TaskItem.kt:627-645`, pill
  shape instead of 4 dp corners.
  Accept: vectors pass in both themes; captures.

- [x] **2.4 Smart list identity (F-3)** · a desk Haiku · b droid Haiku
  Icons and colours from the identity table. a) `SmartListNav.tsx:16-22`, view headers, Quick View
  if it shows list icons (empty states follow in 2.7). b) `DrawerContent.kt:74-79`, the bottom
  bar, widget list pickers. Drift tests: the code's table equals the token file. Check
  `CircleCheckBig` exists in lucide-react 0.400 (else the closest icon, noted).

- [x] **2.5 Section headers (D-4, A-12)** · a desk Sonnet · b droid Sonnet
  Two levels. Level 1 (Overdue, Today, a day): 13/600 sentence case with a count, Overdue in
  status.overdue. Level 2 (a project inside it): 12/600 with the project colour dot. A group of one
  task gets no header; the project goes on that row's meta line.
  a) `ListSectionHeader.tsx` (the existing `task-list/SectionHeader.tsx` is the project-section
  header with rename, menu and drag; it adopts the level-2 style but keeps its behaviour) replaces
  the five styles in Today, Anytime, Tag, Area, Upcoming, Routines; sticky (the stuck hairline is
  4.11a).
  b) `CollapsibleSection.kt` becomes `SectionHeader(level, title, count, dot)` in Today, Upcoming,
  Anytime, Tag, Project, CustomList; the expanded state is announced.
  Accept: captures; counts change when a task completes.

- [x] **2.6 Row anatomy (D-2, A-1, F-7, D-11)** · a desk Sonnet · b droid Sonnet · c desk Sonnet
  Line 1: the title, level with the checkbox. Line 2 (meta 12, text.secondary): project (unless the
  view or group implies it), label pills, checklist "1 of 3", notes icon, repeat. Right cluster:
  due time or overdue age (date display contexts), reminder bell, priority mark. No "Today" in
  Today, no day under a day header, no current tag in a Tag view, no project inside itself.
  a) `TaskRow.tsx`: labels leave `:559-571`; a grid replaces `pl-[43px]`/`pl-[46px]` (the
  reading column is 2.7). b) `TaskItem.kt`: the label FlowRow moves
  to the meta line; the 48 dp checkbox target stays. c) Quick View rows: circle checkbox, the
  priority mark at the end, the same date roles.
  Accept: Today in both apps matches the proposal mocks in structure; rows at most two lines;
  drag and keyboard still work (scenario `drag-reorder`).

- [x] **2.7 Page header, buttons, empty states (D-10, D-19)** · desk · Sonnet
  `PageHeader` (title 26/700, optional subtitle, actions right) and one content width for every
  view: a centred reading column of 720 to 760 px in `ContentArea.tsx`; `Button` with primary,
  secondary and quiet only; `EmptyState` with the list's identity
  icon, a text.secondary subtitle and an action wherever adding is possible (`TaskList.tsx:460`,
  `ProjectView.tsx:206`); Today's empty state says "All clear" (animated in 4.11a). Routines and
  Review lose their own headers and centred column; Settings uses the role buttons and the app's
  switch and checkbox, and "Test Connection" stays enabled with the saved token, with a helper
  line ("Uses the saved token. Paste a new one to replace it."); the title-bar band keeps one
  colour on every view.
  Accept: captures of Routines, Review, Settings, empty Inbox, empty Today.

- [x] **2.8 One place to add a task (D-5)** · desk · Sonnet
  A quiet "New task" row at the end of each list turns into the composer in place; the header "+"
  adds at the top; the existing shortcut stays. In Area views, "Add section" moves to the project
  menu and appears on hover between sections. The dashed pills go.
  Accept: captures of Today, Inbox and an Area view; the composer opens at the end and at the top.

- [x] **2.9 Logbook and Review rows (D-12, A-9)** · a desk Sonnet · b droid Sonnet
  Logbook grouped by completion day (`logbook.group`), plain muted titles with a filled check,
  the completion time on the right; paging still loads older pages. b) also Review rows: an icon
  button (or swipe) marks reviewed, so names keep their width; the review state matches desktop
  (grey "Not reviewed yet", amber "Due"), not onSurfaceVariant for every state.
  Accept: captures, including Review at font scale 1.3 without truncated names.

### Wave 3: interaction, accessibility, the clunky flows

Before 3.4 to 3.6: the parser task from 0.1 is merged or rebased in.

- [x] **3.1 Row, checkbox and list semantics (D-20)** · desk · Sonnet
  dnd-kit's `attributes` move to a drag handle (or are overridden through `useSortable`), so a row
  is no longer a button that contains buttons (`TaskRow.tsx:555`); lists `role="list"`, rows
  `role="listitem"`, focus through the existing keyboard selection (roving tabindex); checkbox
  `role="checkbox"`, `aria-checked`, name "Complete <title>" (`TaskCheckbox.tsx:34`).
  Accept: axe on Today, Upcoming and an open card: no serious or critical violations.

- [x] **3.2a Menu and dialog primitives (D-20)** · desk · Sonnet
  On the 1.3 popover: `Menu` (`menu`, `menuitem`, `menuitemradio`, roving focus with arrows,
  Home/End, typeahead, submenus, Escape returns focus) and `Dialog` (modal `<dialog>` with
  `showModal()`, focus trap, labelled title, Escape, focus return; `ConfirmDialog.tsx` and
  `CustomListDialog.tsx` move onto it). Pure keyboard logic (roving index, typeahead) in tested
  helpers.

- [x] **3.2b Context menu (D-18)** · desk · Sonnet
  `TaskContextMenu.tsx` on `Menu`: one icon column, right-aligned shortcut hints (only real ones),
  order When, Priority, Tags, Move | Copy, Complete | Delete, priority items with `PriorityMark`,
  the current one as a checked radio.
  Accept: scenario `context-menu-keys` (Shift+F10 opens, arrows, Enter, Escape, focus returns).

- [x] **3.2c Listbox pickers (D-20)** · desk · Sonnet
  Priority, Label, DraftLabel, Project and Recurrence pickers get `listbox`/`option` roles,
  arrow keys, typeahead and `aria-selected`; Info gets `dialog`.
  Accept: axe on each open picker; scenario `picker-keys`.

- [x] **3.3 Task card toolbar and surface (D-3)** · desk · Sonnet
  Set properties show as chips that open their editor (date, priority, labels, checklist,
  reminder, repeat, project); unset ones as quiet "+" buttons; info and delete under More; styled
  tooltips with shortcuts (on the popover layer, 400 ms delay, fade.fast). Dark card: bg.card
  plus the 1 px highlight, no shadow. Same order as the Android editor (3.7). The morph is 4.4.
  Accept: captures of an open card with and without properties, light and dark.

- [x] **3.4a1 When panel (D-7)** · desk · Sonnet
  `WhenPanel`, a component with no popover of its own. Top: a text field ("Type a day, a date or
  a time") using the quick-add parser's date extraction, with a live preview. Quick choices with
  weekdays (Today Wed, Tomorrow Thu, This weekend Sat, Next week Mon 12, computed from today).
  Month grid (`role="grid"`, arrows, PageUp/PageDown months, Home/End, Enter; today ringed). Time
  row (None, 09:00, 12:00, 15:00, 18:00, typed custom). Date-only picks use `dateOnlyDue()`. The
  grid's date math and the text-to-selection mapping are pure and tested.

- [x] **3.4a2 When popover and reminders (D-7)** · desk · Sonnet
  `WhenPopover` (WhenPanel in the 1.3 popover, footer Repeat and Clear in danger) replaces
  `DatePickerPopover` and its native `<input type="date">`. `ReminderPickerPopover` reuses
  WhenPanel instead of its native date-time input; its "Add reminder" button is enabled as soon
  as a day is picked (no 40% disabled state while a field is empty), and quick choices add a
  reminder directly.
  Accept: E5: "tomorrow 9am" selects tomorrow at 09:00; "next mon" the coming Monday; a click on
  day 20 updates the text; Clear sends `due_date: null`; a reminder can be added in two clicks.

- [x] **3.4b When sheet (D-7)** · droid · Sonnet
  `WhenSheet` (ModalBottomSheet) in the same order: text field with the Android parser, quick
  choices, the Material `DatePicker` docked in the sheet, time chips. It replaces the stacked
  buttons and the `DatePickerDialog.kt` flow and opens from the swipe schedule action. Spike first:
  `TaskDetailScreen.kt:182-185` records an M3 sheet nested-scroll bug; if the docked DatePicker
  hits it, keep quick choices, text field and time chips in the sheet and open the calendar as
  `DatePickerDialog` from a "Pick a date" chip.
  Accept: A6, with the same results as E5.

- [x] **3.5 Composer chips follow the parser (D-6, F-5)** · desk · Sonnet
  One source of truth: a chip shows the parsed value unless the user set that chip, in which case
  the chip wins and the token loses its highlight (fixes `NewTaskComposer.tsx:287-297`, which saves
  values the chips did not show). The suggestion list floats under the caret as a `listbox` on the
  popover primitive (`aria-activedescendant`). The send button sits next to the text with an Enter
  hint. Quick Entry gets the same chip behaviour and colours. The token-into-chip animation is 4.11a.
  Accept: E6.

- [x] **3.6 Compact quick add (A-6)** · droid · Sonnet
  `TaskEntrySheet.kt`: a compact sheet resting on the keyboard (`imePadding`, wraps content), the
  title with live highlights, one chip row (When, Project, Tags, Priority) with parsed values in
  words (2.1b), a "+ Notes" chip that grows the sheet; the date appears once. The chip rule from
  3.5, tested in the ViewModel.
  Accept: A5.

- [x] **3.7 The task editor reads as a task (A-7)** · droid · Sonnet
  `TaskDetailScreen.kt`, still full screen (reason at `:182-185`): an editable headline
  (BasicTextField, headlineSmall, no outline), notes as plain text, one row of property chips in
  the desktop order (empty ones as "+ Reminder", "+ Repeat"); the seven icons go; a back arrow and
  "Done" replace the X; footer "Created <date>. Saved as you type." Autosave unchanged.
  Accept: capture matches the proposal mock's structure.

- [x] **3.8 Quick find and command palette (D-8)** · desk · Sonnet
  Search leaves the window controls. A "Quick find" field at the top of the sidebar (Ctrl+F
  focuses it) shows live results: cached tasks at once, the server search debounced 250 ms, a
  keyboard-navigable listbox, Enter opens. Command palette on Ctrl+Shift+P (confirm it is unbound):
  tasks, projects, labels, smart lists and actions (New task, Go to, Toggle theme, Settings),
  fuzzy match, on the 3.2a `Dialog`.
  Accept: E8.

- [x] **3.9 Sidebar tree with progress (D-9)** · a desk Sonnet · b droid Sonnet
  a) `ProjectTree.tsx` renders children: collapsible areas (expansion saved in config), projects
  with a small progress ring, counts on Inbox, Today and Review as in the mock. Spike first
  (decision 11): a new main call `countProjectTasks(projectId, done)` behind `handleTrusted` that
  sends one `per_page=1` request and returns the API v2 envelope's `total` (the api-client drops it
  today), minus the hidden carrier tasks known for that project (`carrier-ids.json`); cached 10
  min, refreshed on completion events. If `total` is unusable, an open count instead.
  b) The same ring in the Android drawer, same data rule.
  Accept: captures of sidebar and drawer; the harness counts requests (at most projects + 1).

- [x] **3.10 Selection bar (D-17)** · desk · Sonnet
  Selected rows use bg.selected. With two or more selected, a bar slides up from the bottom of the
  list: "3 selected", Schedule (WhenPopover), Complete, Move, Tag, Delete; Escape clears.
  Accept: E9.

- [x] **3.11 Setup screen (D-16)** · desk · Haiku
  Logo, "Welcome to Vicu", the same one-line explanation as Android's setup, then the URL field;
  the steps share one card (the slide is 4.11a).

- [x] **3.12 Loading skeletons (D-22)** · desk · Sonnet
  Today, Inbox, Upcoming, Anytime, Project and Tag keep their PageHeader and show three or four
  skeleton rows instead of "Loading..." (`TodayView.tsx:89-95` and the others). Shimmer is 4.11a.

### Wave 4: motion

Desktop track: 4.1, 4.2a, 4.2b, 4.2c, 4.4, 4.6, 4.8, 4.11a. Android track: 4.3, 4.5a, 4.5b, 4.7,
4.9, 4.10, 4.11b. 4.12 closes the wave.

- [x] **4.1 Motion foundation (desktop)** · desk · Sonnet
  `lib/motion.ts`: `useReducedMotion()` (from 1.5), `animateFLIP(elements, token)`, a small
  velocity-aware spring for drops, helpers that read the CSS motion vars. Popovers, menus and
  tooltips enter from the anchor side with `@starting-style` (scale 0.96 to 1 and fade.base) and
  exit with `transition-behavior: allow-discrete`; toasts enter and leave with fade.base and a
  small rise. Reduced: opacity only.

- [x] **4.2a Completion hold logic (F-10)** · desk · Sonnet
  `src/shared/completion-hold.ts`: the contract state machine (hold, extension on hover and focus,
  navigation ends it, collapse, merged Undo window, 6 s, paused on hover and focus), tested
  against the `completion` vectors. Wire it into the machinery that exists today instead of
  adding a second one: `stores/completed-tasks-store.ts`, `lib/undo-window.ts` (the `merge*UndoWindow`
  helpers used by `use-tasks`, `use-project-tasks`, `use-project-sections`, `use-logbook-tasks`),
  `suppressTopLevelUndo` (`use-task-mutations.ts:619-632`) and the hold in `AppShell.tsx:140-148`
  ("until you navigate" goes). Undo sends `{ done: false }` per task.

- [x] **4.2b Toasts with actions (D-14, D-21)** · desk · Sonnet
  The toast store and `ToastHost` gain a `success` kind, an action (label and callback), a
  duration and pause on hover and focus; completions use it ("Completed", "3 completed", Undo).
  Review's inline toast (`ReviewView.tsx:344-371`) moves onto it. The live region from 1.4 carries
  the messages.

- [x] **4.2c Checkbox and row motion (D-14)** · desk · Sonnet
  Port Android's checkbox: the ring fills with the pop spring (360 ms), the check path draws over
  220 ms, the title strike draws left to right over 240 ms, the sound stays; after the hold the
  row fades and its height closes (move). Keyboard: Space completes and focus moves to the next
  row's checkbox; the live region says "Completed <title>"; Undo restores rows and focus.
  Accept: E1, E2, E11.

- [x] **4.3 Completing on Android (F-10)** · droid · Sonnet
  `CompletionHold.kt` takes its constants from the contract and passes the `completion` vectors;
  single-task Undo snackbar via `AppMessages` ("Completed", merged count, 6 s); `animateItem()` on
  every list (Reorderable 2.4.3's `ReorderableItem` already applies it by default in Inbox and
  projects: verify, do not add a second one); haptics: `ToggleOn` on completing (replaces
  LongPress), `Confirm` for bulk actions.
  Accept: A1; Inbox reorder still works.

- [x] **4.4 Opening a task (D-3)** · desk · Sonnet
  The row (`TaskRow.tsx:487`) and the card (`:668`) share a per-task `view-transition-name`; open
  and close run in `document.startViewTransition` with `flushSync` for the React swap; the group
  animates with `--spring-move` over 320 ms; card content fades in 40 ms apart (at most 5 items);
  one transition at a time, the latest wins; Enter opens. Reduced: no morph, a 150 ms fade.
  Accept: E3, with a mid-transition capture that differs from both ends.

- [x] **4.5a Editor enter, exit and predictive back (A-13)** · droid · Sonnet
  `VicuApp.kt:552-562`: the editor overlay in `AnimatedContent` (fade and a 6 dp rise from
  `VicuMotion`). `androidx.activity.compose.PredictiveBackHandler` (activity-compose 1.10.1, the
  artifact of today's `BackHandler` at `TaskDetailScreen.kt:3,186`) replaces the `BackHandler` and
  drives the exit with the gesture progress (scale to 0.9 and fade); a cancelled gesture springs
  back.
  Accept: A3 captures at rest, mid-open (animator scale 5) and mid-back gesture (held `motionevent`).

- [-] **4.5b Container transform from the row (A-13)** · droid · Sonnet
  Spike, then build: `SharedTransitionLayout` around the lists and the overlay, `sharedBounds`
  keyed by task id, so the row grows into the editor and the back gesture returns it. If it fights
  the overlay or the lazy lists (rows scrolled away, reorder), keep 4.5a's fade and rise and record
  why in section 7.

- [x] **4.6 Changing views (desktop)** · desk · Sonnet
  TanStack Router `defaultViewTransition` (installed 1.159), `view-transition-name: content` on the
  content region, the root cross-fade off so sidebar and title bar stay; page token (90 ms out,
  210 ms in, 6 px rise); the sidebar selection pill slides with move; keyboard-driven navigation
  skips the transition. Reduced: cross-fade only.
  Accept: E7.

- [x] **4.7 Changing screens on Android (A-5)** · droid · Sonnet
  `AppNavHost.kt:40-43`: fade-through between bottom-bar destinations (out 90 ms; in 210 ms with
  scale 0.92 to 1), shared axis X (30 dp, 300 ms) into a project and back; Navigation 2.9 plays
  them with predictive back. A comment records why commit 0c762fe removed the 700 ms default.
  Accept: captures mid-transition at animator scale 5.

- [x] **4.8 Lists and drops (D-15)** · desk · Sonnet
  New rows open from 0 height and removed rows close (move); reorders use FLIP with
  move.expressive (stagger 35 ms, at most 5). Drag: lift on pickup (scale 1.02, deeper shadow);
  dnd-kit `dropAnimation` travels into the slot over 240 ms with the optimistic order applied
  first (`AppShell.tsx:694`); layout animation back on without the bump (`TaskRow.tsx:61`).
  Reduced: no lift or travel.
  Accept: E10.

- [x] **4.9 Swipe feedback (A-8)** · droid · Sonnet
  `SwipeableTaskItem.kt`: complete (green) and schedule (amber) roles from `LocalVicuColors`; a
  word beside the icon; the tint deepens with distance (12% to 35%); at the 50% commit point the
  colour goes full, the icon pops (pop spring) and `GestureThresholdActivate` plays (replacing
  LongPress); release springs back with pop; schedule opens `WhenSheet`.
  Accept: A2; a unit test keeps the label at 4.5:1 or more at every tint step.

- [x] **4.10 Large titles and the FAB (A-4, A-3)** · droid · Sonnet
  List screens use `LargeTopAppBar` (bold 28 sp) with `exitUntilCollapsedScrollBehavior`
  (`@OptIn(ExperimentalMaterial3Api::class)` on 1.4) and the scrolled container colour. 1.4.0 has
  no subtitle parameter: Today's `header.full` subtitle goes inside the title slot and is hidden
  once collapsed; `VicuFab.kt` becomes an extended "New task" FAB that shrinks to an
  icon while scrolling. The 88 dp clearance stays.
  Accept: A7.

- [x] **4.11 Signature moments** · a desk Sonnet · b droid Sonnet
  Counts roll by one (section counts, sidebar and drawer badges); the last task done turns Today
  into "All clear" with the sun warming (identity colour fade) and offers the next upcoming task;
  a recognised token travels into its chip (desktop composer and Quick Entry, Android quick add).
  Desktop only: stuck section headers gain a hairline (IntersectionObserver sentinel), skeletons
  shimmer once, Setup steps slide. Android only: pull to refresh with the Material indicator,
  `SegmentFrequentTick` on reorder steps.
  Accept: a capture pair per moment; reduced variants are fades.

- [x] **4.12 Reduced motion and smoothness audit** · both · Haiku, then Sonnet
  Haiku runs every motion scenario with `--motion reduce` and full (desktop) and at animator
  scale 0 and 1 (Android), collecting captures, console errors and `frames()` samples. Sonnet
  reviews: no transform or overshoot under reduce; nothing blocks input; animations move
  transform and opacity except the deliberate height close; no frame over 50 ms during E1, E3 and
  E7 on this PC.

### Wave 5: platform polish

- [x] **5.1 Windows chrome, Mica and type** · desk · Sonnet
  `src/main/window-manager.ts`: on Windows, `titleBarStyle: 'hidden'` with `titleBarOverlay`
  (colours from tokens, height of the title band), updated with `setTitleBarOverlay` on theme
  change; `WindowControls.tsx` only on Linux. Mica: `backgroundMaterial: 'mica'` on Windows 11,
  the sidebar translucent through a `[data-platform="win32"]` rule like the darwin one, the
  content opaque; Windows 10 keeps an opaque sidebar. Windows font stack: "Segoe UI Variable Text",
  with "Segoe UI Variable Display" for titles. macOS keeps traffic lights and vibrancy; Linux
  keeps custom controls drawn with tokens. Put the window-option choice in a pure function with
  tests per platform and Windows build number.
  Accept: unit tests; desktop captures; the native parts (Snap Layouts flyout, Mica) are manual
  checks in section 5.

- [x] **5.2 Contrast themes (forced colours)** · desk · Sonnet
  `@media (forced-colors: active)`: checkbox borders and checked state in system colours,
  selection with Highlight and HighlightText, priority marks and identity icons in currentColor
  (shapes carry meaning), the focus ring, chip borders, disabled states.
  Accept: captures with `--forced-colors` of Today, an open card, the When popover, the context menu.

- [x] **5.3 Material 3 Expressive, if available** · droid · Sonnet
  The resolved material3 today is androidx 1.4.0, which has none of the Expressive classes, so
  expect a deferral. Spike: the newest stable Compose Multiplatform material3 and its Jetpack
  equivalent; are
  `MotionScheme.expressive()`, `FloatingActionButtonMenu`, `HorizontalFloatingToolbar`, connected
  `ButtonGroup` and `LoadingIndicator` public there? If yes: upgrade within the repo's AGP and
  Kotlin constraints, keep `VicuMotion` unless the factory's values equal the tokens, and add the FAB
  menu (New task, New project, New list), a floating toolbar for selection actions, connected
  buttons for the WhenSheet quick choices and `LoadingIndicator` for pull to refresh. If no: record
  the deferral in `docs/design-system-v1.md` and section 7; no upgrade.

### Wave 6: verification, docs, release prep

- [x] **6.1 Full capture set** · both · Haiku
  Every scenario in section 5, light and dark; desktop at 1440x900, 1280x820 and 900x600; Android
  at font scale 1.0 and 1.3; reduced motion; forced colours on desktop.

- [x] **6.2 Findings ledger** · both · Sonnet (validator)
  For each of the 45 IDs and each section 6 row: evidence (capture, test name, file:line) and a
  verdict (done, partial, not done), comparing with `out/baseline/` and the proposal mocks. Writes
  `scripts/ui-verify/out/ledger.md` (not committed) and returns only rows that are not done.

- [x] **6.3 Code review** · per repo · Sonnet
  Review `main...design/review-2026-10` for correctness and the CLAUDE.md rules (merge patches,
  `handleTrusted`, shared-module purity, identical fixtures, no raw colours, reduced variants,
  accessible names). At most 15 ranked issues.

- [x] **6.4 Fix loop** · Opus
  Triage 6.2 and 6.3 into fix cards, run them, re-gate. Two cycles at most; the rest goes to section 7.

- [x] **6.5 Docs and versions** · Haiku
  Desktop CLAUDE.md Styling section (token pipeline, channel variables, guard tests, popover and
  menu primitives, motion tokens, reduced motion, the ui-verify harness) mirrored in AGENTS.md;
  Android CLAUDE.md (theme, `LocalVicuColors`, `VicuMotion`, token tests, harness, emulator-only
  rule); release notes `docs/releases/v1.10.0.md` and the Android equivalent (plain, user-facing,
  grouped, no emojis: Vicu colours by default and where the device colours switch is, the
  completion hold and Undo, the When picker, Quick find, the new rows and headers); versions to
  1.10.0 (desktop `package.json` and lock; Android versionName and versionCode).

- [x] **6.6 Sign-off** · Opus
  Final gates in both repos; a summary for you with before and after captures (optionally a
  version 3 of the review artifact with an "Implemented" section) and the manual checks. Push,
  PRs and tags wait for your go-ahead.

---

## 5. End-to-end scenarios

Run against the seeded local server. Desktop through `npm run ui:verify`, Android through
`scripts/ui-verify/shots.mjs` on emulator-5554. The wave in brackets is the first wave that
runs it; earlier waves check only what exists by then. Dates are relative to the run date
("tomorrow", "the coming Saturday"); the scenario code computes the expected strings.

Desktop:

| ID | Scenario | Expected |
|---|---|---|
| E1 [4] | Click a Today checkbox, rest the pointer, move away | Pop and drawn check; row held while hovered, collapses about 5 s after leaving; toast "Completed, Undo" |
| E2 [4] | Complete two rows by keyboard (Space) | Focus moves to the next checkbox; live region announces; toast reads "2 completed"; Undo restores both and refocuses |
| E3 [4] | Click a row, then another; Enter on a third | Row grows into the card; the first card closes as the second opens; Enter opens |
| E4 [1] | Schedule on the last Today row at 1280x820 and 900x600 | Popover inside the window, flipped above; inner scroll at 600; Escape and focus return (wave 1); arrows and End (from wave 3) |
| E5 [3] | When popover: "tomorrow 9am", day 20, "Next week" | Tomorrow 09:00 selected; text follows the grid; the coming Monday |
| E6 [3] | Composer: "Call Ana Saturday 3pm #Personal !3", Enter | Chips show the coming Saturday at 15:00 ("Sat 10 Oct, 15:00" style), "Personal", "High"; the server task has exactly those |
| E7 [4] | Today to Upcoming by mouse, then by keyboard | Content cross-fades with a rise, sidebar pill slides; keyboard switch instant |
| E8 [3] | Ctrl+F "plumb"; Ctrl+Shift+P "logbook", Enter | Live results before Enter; palette navigates to Logbook |
| E9 [3] | Ctrl-click three rows, Schedule, Tomorrow | Bar "3 selected"; all three due tomorrow; bar leaves |
| E10 [4] | Drag a row two places down | Lift, travel into the slot, no snap back 50 ms after the drop; order saved |
| E11 [4] | E1 and E7 with `--motion reduce` | No transforms or overshoot; same hold timing |
| E12 [5] | Today, card, When popover, menu with `--forced-colors` | Every control and state visible |
| E13 [1] | Quick Entry with parsed text; Quick View list | Highlights aligned and role colours (wave 1); circle checkboxes and priority marks at the end (from wave 2) |
| E14 [3] | axe on Today, Upcoming, open card, When popover, context menu, Settings | No serious or critical violations |
| E15 [6] | All views at 1440x900, 1280x820, 900x600, light and dark | No overflow, no clipped popovers, contrast roles in place |

Android:

| ID | Scenario | Expected |
|---|---|---|
| A1 [4] | Tick a checkbox in Today | Spring check, `ToggleOn`; row leaves after 5 s; snackbar "Completed, Undo"; Undo restores |
| A2 [4] | Swipe right to 40%, to 60%, release; swipe left past 50% | Tint deepens; armed state pops at 50%; completes; schedule opens WhenSheet |
| A3 [4] | Open a task; back gesture held halfway; release | Container transform from the row; the editor follows the gesture; returns to the row |
| A4 [1] | Upcoming | Day groups, sticky (wave 1); `header.day` labels and the project on each row's meta line (from wave 2) |
| A5 [3] | FAB, type "Call Ana Saturday 3pm #Personal" | Compact sheet on the keyboard; chips show the coming Saturday at 15:00 and "Personal"; "+ Notes" grows it |
| A6 [3] | WhenSheet: "tomorrow 9am", a calendar day, "Next week" | Same results as E5 |
| A7 [4] | Scroll Today | Large title folds into the bar; FAB shrinks to an icon |
| A8 [1] | Light, dark, device colours off and on | Vicu blue by default; harmonised status colours with device colours |
| A9 [2] | `a11y.mjs` on Today, Upcoming, editor, quick add, drawer | Named checkboxes with state; every target at least 48 dp; chips have text |
| A10 [1] | `pm clear` the debug app, launch, set up | No permission prompt before setup; rationale, then prompt |
| A11 [2] | Font scale 1.3: Review, Today, editor | No truncated project names in Review; rows wrap cleanly |
| A12 [6] | Today in both apps, side by side | Same anatomy, headers, priority marks, date phrasing and identity |

Manual checks for you (native or device-only): Snap Layouts flyout on the maximise button and
Mica behind the sidebar (Windows 11); one Narrator pass on a task row and the When popover; one
TalkBack pass on Today and the editor; a macOS and a Linux build from CI, opened once.

---

## 6. Coverage

| ID | Cards | | ID | Cards |
|---|---|---|---|---|
| F-1 | 1.1, 1.1b | | D-12 | 2.9a |
| F-2 | 1.6a, 1.6c | | D-13 | 1.4b |
| F-3 | 2.4 | | D-14 | 4.2a to 4.2c, 4.3 |
| F-4 | 0.5, 1.2, 1.6b, 1.7, 2.3 | | D-15 | 4.8 |
| F-5 | 2.2, 3.5 | | D-16 | 3.11, 4.11a |
| F-6 | 0.5, 2.1 | | D-17 | 3.10 |
| F-7 | 1.1, 1.4, 1.4b, 2.6 | | D-18 | 3.2b |
| F-8 | 0.5, 1.1, 1.2, 1.4b, 1.6a, 1.7 | | D-19 | 1.4, 2.7 |
| F-9 | 2.3 | | D-20 | 1.5, 3.1, 3.2a, 3.2c |
| F-10 | 0.5, 4.2a, 4.3 | | D-21 | 1.4, 4.2b |
| D-1 | 1.3 | | D-22 | 3.12, 4.11a |
| D-2 | 2.6a, 2.7 | | A-1 | 2.3b, 2.6b |
| D-3 | 3.3, 4.4 | | A-2 | 1.8, 2.1b |
| D-4 | 2.5a | | A-3 | 1.7b, 4.10 |
| D-5 | 2.8 | | A-4 | 4.10 |
| D-6 | 3.5, 4.11a | | A-5 | 4.7 |
| D-7 | 3.4a1, 3.4a2, 3.4b | | A-6 | 3.6, 4.11b |
| D-8 | 3.8, 5.1 | | A-7 | 3.7 |
| D-9 | 3.9a, 3.9b | | A-8 | 4.9 |
| D-10 | 2.7 | | A-9 | 2.9b |
| D-11 | 1.2, 1.4, 2.6c | | A-10 | 1.9 |
| | | | A-11 | 1.7b |
| | | | A-12 | 1.7, 2.5b |
| | | | A-13 | 4.5a, 4.5b |

Proposal items:

| Item | Cards |
|---|---|
| Token contract, drift and contrast tests | 0.5, 1.1, 1.6a, 1.6b, 2.4 |
| Consistency matrix targets (review state, completion, selection, search, logbook, date picker) | 1.4b and 2.9b, 4.2 and 4.3, 3.10, 3.8, 2.9, 3.4 |
| Smart list identity | 2.4, 2.7 |
| Today, redesigned (both mocks) | 2.5 to 2.7, 3.8, 3.9, 4.10; checked in 6.2 and A12 |
| When picker, Android editor, Android quick add | 3.4, 3.7, 3.6 |
| Platform polish: Windows overlay, Mica, Segoe UI Variable, forced colours | 5.1, 5.2 |
| Platform polish: macOS and Linux | 5.1 |
| Platform polish: Material 3 Expressive | 5.3 |
| Haptics map | 4.3, 4.9, 4.11b |
| Accessibility: focus ring, 11 px floor, targets, colour-only meaning, reduced motion | 1.5, 1.4, 1.5 and 2.6b, 2.2, 1.5 and 4.12 |
| Motion moments: complete, open, change view, lists, menus, swipe, scroll, loading, last task, counts | 4.2c and 4.3, 4.4 and 4.5a/b, 4.6 and 4.7, 4.8 and 4.3, 4.1, 4.9, 4.10 and 4.11a, 3.12 and 4.11, 4.11, 4.11 |

---

## 7. Open items and risks

Open items (filled in during the run):

- Android `VicuMotion` is a plain object: `MotionScheme` is internal in CMP material3 1.9.0. Switch
  when a stable multiplatform release makes it public (5.3 deferral, design-system section 6).
- 4.5b container transform on Android deferred: needs a row-bounds registry shared by the list and
  the editor; the editor fades and rises in meanwhile.
- 5.3 Material 3 Expressive deferred (first public in androidx material3 1.5.0-beta01, not in a
  stable CMP release).
- Android DatePicker weeks start on Sunday; desktop starts on Monday.
- `ARBITRARY_SIZE_ALLOWLIST` still holds 15 entries.
- Sidebar progress rings do not roll like the counts.
- Android swipe left opens the When sheet only with the "Choose when" setting.
- Android drawer bottom row is clipped at 46 dp on the test emulator.
- Android routine archive parts are known only after Routines has loaded once.
- An Upcoming title mismatch was seen once in a desktop harness run and not reproduced.
- A time picked inside a spring-forward gap (02:30 on the DST day) is stored an hour later; the
  contract says nothing about it, so it needs a cross-app rule before either app changes.
- A typed "12am" becomes local 00:00, which the contract reads as date-only (both apps).
- Undo of a repeating task restores its dates in the main window (both apps) but not from Quick View,
  and not for an offline-queued completion on Android.
- Attachment uploads bypass the serial write path in both apps (desktop: one hung request also
  delays other writes up to its 10 s timeout). Android has no fail-fast for the writes waiting
  behind a network failure (desktop answers them NOT_SENT_AFTER_NETWORK_FAILURE).
- This PC's display runs at 32 Hz (Remote Display Adapter): one missed frame reads 62.5 ms, so the
  50 ms smoothness assertions can flake while the machine is loaded.
- Android 4.12 frame target not met on the emulator (debug build): the first frame of a new screen
  takes 68 ms (editor open) and 102 to 118 ms (tab switch to Anytime, Upcoming); everything else stays
  under 50 ms. Measure on a release build on a real device before optimising (baseline profiles,
  lighter first composition). The emulator's graphics stack degrades after about 1.5 h of captures;
  frame numbers need a freshly started emulator.

| Risk | Mitigation |
|---|---|
| The parser task and 3.4 to 3.6 touch the same code | 0.1 checks it; those cards wait for it and rebase |
| Native popover nesting or dnd-kit conflicts | Spike in 1.3; portal fallback with the same positioning |
| View Transitions with React 18 | `flushSync` inside the transition; one at a time; only the content region and the task pair |
| Compose Multiplatform API gaps (predictive back, shared transitions, haptic types, expressive) | Each card checks what 1.11.1 exposes in common code and records the fallback |
| ICU and java.time phrase dates differently | Strings built from parts; fixtures pin en-US and en-GB |
| The new defaults surprise people (Android colours, 5 s hold on desktop) | Decisions 2 and 3; release notes; the Settings switch |
| One large diff | A commit per card, wave gates, an optional 1.9.1 after wave 1 |
| This PC reports reduced motion | The harness forces full motion; section 1, decision 15 |

---

## 8. Log

One entry per wave sign-off (date, cards committed, gate results, validator verdicts, open items).

- 2026-10-07: plan written, then checked by a Sonnet validator against both codebases and the
  review. Applied: token values that failed their own contrast list, Android due-chip colours (no
  card before), radii and tertiary-text migration, Android review state, the reminder button,
  all six MotionScheme slots, the existing `SectionHeader.tsx` name clash, a dialog primitive,
  the existing completion and undo code, the real 12/24 h situation, `popover` typing, the API v2
  `total` envelope, the sidebar vibrancy exception, Android API corrections (no MDC,
  `PredictiveBackHandler` artifact, `animateItem` already on reorderable rows, no
  `LargeTopAppBar` subtitle, the sheet nested-scroll spike), gates per CLAUDE.md, line endings,
  relative dates, wave tags, and splits of oversized cards.
- 2026-10-08: readiness check. Parser task merged (desktop #36, Android #31). Android gate green.
  Desktop green (2576 tests) once vitest skips `.claude/worktrees/` copies (now part of 0.1).
  Decided: the unpushed routines commit rides along on the design branch; the leftover worktrees
  were removed, after which desktop runs 127 test files, all green.
  Not blocking: old branches (`paste-images-into-task-notes`, `pr-33`, Android
  `claude/widget-sync-exclude-feature-5PL3s`), an old stash on desktop, Android PRs #27 and #28
  (external widget changes; settle them before wave 2 touches widgets). Token pass: warm agents
  per track, one orchestrator session per wave, line-range briefs, bounded validators.
- 2026-10-08 (wave 0 and 1, one session): all wave 0 and wave 1 cards committed in both repos.
  Desktop 02fb297..f939383 (0.1, 0.2a, 0.2b, 0.5, 1.1, 1.1b, 1.2, 1.3 via worktree, 1.4, 1.4b,
  picker follow-ups, 1.5, w1-fix1); verify green (144 files). Android d855c41 harness, cd9f618
  contract, 6bd1a35 (a test that broke on 2026-10-08: its cached task was due that day),
  64d6464..46ff0bd (1.6a-c, 1.7, 1.7b, 1.8, 1.9 + fix a70e66f); `test lint assembleDebug` green,
  a4 and a10 pass on emulator-5554. Desktop validator: all 7 PASS, fixes folded into w1-fix1.
  Open: VicuMotion cannot implement MotionScheme (internal in CMP material3 1.9.0).
- 2026-10-08 (wave 2 and 3, same session): desktop wave 2 3f435bc..d2e7d11 and wave 3 f388480..9d137ff
  (parallel worktree tracks cherry-picked; w3-int dc8b3c5 fixed the merge; serial task writes and
  replay retry 0aea14b after SQLite "database is locked" on bulk actions). Wave 3 scenarios 519/520
  passes, 0 fails, axe clean. Android wave 2 9f650f6..b4f5a80, 3.4b 5f82ae0. Validators: desktop w2
  and w3 PASS with fix cards applied; Android w2 failed Upcoming (projects), fixed in b4f5a80.
  Open: Android DatePicker week starts Sunday; Android ghost rows after a server-side delete.
- 2026-10-08 (wave 4 and 5, same session): desktop wave 4 5743af0..26bc562 (4.1, 4.2a-c, 4.4,
  4.6, 4.8, 4.11a), wave 5 cad6162 (5.1) and d1aa934 (5.2), then 36f6c65, a07d8ae, 255c663
  (w4-fix1), f0598c4 (harness). Wave 4 light 711 passes, 0 fails; dark had 23 sidebar contrast
  failures that came from the harness re-setting data-material after a reload (a07d8ae).
  `npm run verify` green (180 files, 3316 tests). Android 78bb5dc..c78310e (4.3, 4.5a, 4.7, 4.9,
  4.10), 58d7011 (5.3 deferral); 4.5b deferred. A long-running `npm run dev` from before wave 0
  looked broken (no caption buttons, black text) because its main process predates 5.1: restart
  dev sessions after a wave lands.
- 2026-10-09 (waves 4.12 and 6, same session): desktop 3fdc133 (CLAUDE.md), bb1701a (4.12),
  45a7035 (6.4 cycle 1, seven review issues plus repeating-task Undo), 8ce2c1c and 228c8ba (cycle 2:
  axe fixes in Settings and the open card, forced-colours-aware scenarios, E15, E14 extended), b52c407
  (1.10.0). Android 6e38e2f (CLAUDE.md), 4ae1346 (4.11b), 3f762c6 (6.4 cycle 1: serial writes, ghost
  rows, Undo, haptics, rings), 7d792fc (4.12 and a folded-title fix), 2ccd150 (cycle 2: chips wrap at
  font 1.25 and up, a12), eefd9cf (1.10.0, versionCode 42). Final capture set: desktop 766/767/766
  passes at 1280 light, dark and 1440 with 0 fails, the 900, reduce and forced runs green after
  cycle 2; E15 and E14 222 passes light and dark, 0 axe. Android light, dark and font 1.3 green after
  cycle 2, a11y 0 findings. Ledger: 44 of 45 IDs done, A-13 partial (4.5b deferred). Gates: desktop
  `npm run verify` 184 files, 3384 tests; Android `test lint assembleDebug` green. Not pushed, no PRs
  or tags. Manual checks left: Snap Layouts and Mica on Windows 11, Narrator, TalkBack and haptics on
  a phone, Android frame timing on a release build, the macOS and Linux CI builds.
