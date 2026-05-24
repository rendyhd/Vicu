# Project Review Tracking — Vicu Desktop

**Date:** 2026-05-24
**Status:** Design, ready for implementation plan
**Companion specs:**
- `vicu-android/docs/superpowers/specs/2026-05-24-project-review-design.md` — Android client
- `vikunja-mcp/docs/superpowers/specs/2026-05-24-project-review-design.md` — MCP service + Claude Code skill

This spec is self-contained. The marker protocol (Section 3) is the source of truth and is reproduced verbatim in the companion specs.

---

## 1. Goal

Add a GTD-style project review workflow to Vicu Desktop. The user wants to be reminded — and able to mark — when each Vikunja project was last reviewed, on a configurable cadence (default 14 days). Review state must sync via Vikunja so the Android client and an MCP-based AI agent can read/write the same data.

## 2. Non-goals

- Per-task review state. Reviews are at the project level only.
- A guided review wizard or session UI. The action is a single click; the user does the actual reviewing in their head.
- Notifications or background reminders.
- A new IPC surface in the main process. The feature is renderer-only on top of existing project endpoints.
- Migrating descriptions written by other Vikunja clients. Untracked projects stay untracked until first review.

## 3. Marker protocol (canonical spec)

Review state is encoded as a plaintext footer at the end of `Project.description`.

### Grammar

```
{user's existing description, may be empty or multiline}

---
**Vicu review**: <value>
```

The marker block consists of exactly:
- A leading `\n---\n` separator on its own line.
- A single line: `**Vicu review**: ` followed by a value.
- No trailing content. The marker MUST be the last non-empty block.

### Values

| Form | Meaning |
|------|---------|
| `2026-05-24 · every 14 days` | Last reviewed on date; per-project cadence override of 14 days. |
| `2026-05-24` | Last reviewed on date; uses global default cadence. |
| `excluded` | Project opts out of review tracking. Never appears in the review list. |
| `never · every 7 days` | Tracked with cadence override but not yet reviewed. Treated as overdue immediately. |
| (no marker) | Default: tracked, never reviewed, uses global default cadence. Treated as overdue immediately. |

### Reserved tokens

- `**Vicu review**:` — exact prefix, bold, colon-space terminator. Case-sensitive.
- `·` (U+00B7 MIDDLE DOT) — separator between date and cadence. ASCII fallback: ` | ` (space-pipe-space) accepted on read, never written.
- `every N days` / `every N weeks` — cadence form. Canonical written form is `every N days`. On read, also accept `every Nd`, `N days`, `every N week(s)`.
- `never`, `excluded` — special date tokens, case-insensitive on read.

### Parsing rules (read)

1. Find the **last** occurrence of `\n---\n**Vicu review**: ` in `description`. If absent, marker = none → project is untracked-default.
2. Parse the value to end-of-string, trim whitespace.
3. Split on `·` or ` | ` (read-only fallback). Trim each part.
4. First part: ISO 8601 date (`YYYY-MM-DD`), or `never`, or `excluded`.
5. Optional second part: cadence (`every N days|weeks|d`).
6. Malformed marker (e.g., garbage after the prefix): log a warning to console, treat as untracked-default, do NOT modify on next write — preserve the user's text.

### Serialization rules (write)

1. Use `upsertFooter(description, meta)` which:
   - Strips any existing marker block (`\n---\n**Vicu review**: ...` to end).
   - Right-trims trailing whitespace from what remains.
   - Appends `\n\n---\n**Vicu review**: <canonical value>` (two newlines before the separator if remainder is non-empty; one if it ends with newline).
2. Canonical value formatting:
   - Date: `YYYY-MM-DD` in user's local timezone (matches Vikunja's expected date storage for due dates).
   - With cadence: `<date> · every <N> days` (always `days`, even if user typed `weeks` — convert).
   - Excluded: `excluded` only, no cadence.
3. Never write if computed marker is identical to current marker (avoid no-op writes that bump Vikunja's `updated` timestamp).

### Disambiguation

The user may legitimately use `---` (horizontal rule) inside their description. The marker is recognized **only** when `---\n` is followed immediately by `**Vicu review**: `. A horizontal rule with any other following content is ignored.

If the user manually edits the marker (e.g., changes the date), Vicu parses what's there and treats it as truth. Vicu never silently "corrects" user input.

## 4. Architecture

A single new domain concept, `ReviewMetadata`, lives entirely in the renderer. It is derived by parsing the tail of each `Project.description`. Storage and HTTP are unchanged; we reuse `updateProject`.

```
┌──────────────────────────────────────────────────────────┐
│ Renderer                                                 │
│                                                          │
│   src/renderer/lib/review-metadata.ts        ◄── new     │
│     parseReviewFooter, serializeReviewFooter,            │
│     upsertFooter, stripFooter, computeStatus             │
│                                                          │
│   src/renderer/hooks/use-review.ts           ◄── new     │
│     useProjectsNeedingReview()                           │
│     useMarkReviewed()                                    │
│     useSetReviewCadence()                                │
│     useExcludeFromReview()                               │
│                                                          │
│   src/renderer/views/ReviewView.tsx          ◄── new     │
│   src/renderer/components/review/            ◄── new     │
│     ReviewListRow.tsx                                    │
│     ReviewSettingsPanel.tsx                              │
│     ReviewProjectActions.tsx (optional inspector entry)  │
│                                                          │
│   src/renderer/components/sidebar/                       │
│     SmartListNav.tsx                         ◄── edit    │
│   src/renderer/router.tsx                    ◄── edit    │
│   src/renderer/views/SettingsView.tsx        ◄── edit    │
│                                                          │
│ Main                                                     │
│   src/main/config.ts                         ◄── edit    │
│     AppConfig.review = { enabled, default_cadence_days,  │
│                          exclude_inbox }                 │
└──────────────────────────────────────────────────────────┘
```

No new IPC handlers. No changes to `src/main/api-client.ts`. No changes to existing project mutation paths.

### Why renderer-only

Review state is derived presentation logic over already-fetched project data. TanStack Query already caches projects; `useProjectsNeedingReview()` is a pure selector. Adding it to the main process would mean either (a) duplicating the project cache in main, or (b) round-tripping per project. Both worse than parse-on-render.

### Why no `useReviewMetadata(project)` hook

It's pure synchronous parsing — not a hook concern. Components call `parseReviewFooter(project.description)` directly. The hooks layer is reserved for things with React lifecycle (mutations, cache subscriptions).

## 5. Module specs

### 5.1 `src/renderer/lib/review-metadata.ts`

```typescript
export interface ReviewMetadata {
  state: 'never' | 'reviewed' | 'excluded';
  lastReviewedAt: string | null;     // ISO date, null if state !== 'reviewed'
  cadenceDaysOverride: number | null; // null = use global default
}

export interface ReviewStatus {
  metadata: ReviewMetadata;
  effectiveCadenceDays: number;       // resolved against global default
  nextReviewAt: Date | null;          // null if excluded
  isOverdue: boolean;                  // true if never-reviewed or now > nextReviewAt
  daysSinceReviewed: number | null;    // null if never reviewed
  daysUntilDue: number | null;         // negative if overdue; null if excluded
}

export const REVIEW_MARKER_PREFIX = '**Vicu review**:';
export const REVIEW_MARKER_SEPARATOR = '---';

export function parseReviewFooter(description: string | null | undefined): ReviewMetadata;
export function serializeReviewFooter(meta: ReviewMetadata): string;
export function upsertFooter(description: string, meta: ReviewMetadata): string;
export function stripFooter(description: string): string;
export function computeStatus(
  meta: ReviewMetadata,
  globalDefaultCadenceDays: number,
  now?: Date
): ReviewStatus;
```

Implementation notes:
- `parseReviewFooter` MUST handle null/undefined/empty input (returns `{ state: 'never', lastReviewedAt: null, cadenceDaysOverride: null }`).
- `parseReviewFooter` and `upsertFooter` are pure; no IO. Side-effect-free.
- `computeStatus` accepts an optional `now` parameter for testability (default `new Date()`).
- Date comparisons use UTC midnight to avoid timezone drift bugs that already burned Vicu in `use-filters.ts:39` (per the existing comment).

### 5.2 `src/renderer/hooks/use-review.ts`

```typescript
export function useProjectsNeedingReview(): {
  data: Array<{ project: Project; status: ReviewStatus }>;
  isLoading: boolean;
};

// All tracked (non-archived, non-excluded), regardless of overdue status.
// Used by the Review view's "All tracked" mode.
export function useTrackedProjects(): {
  data: Array<{ project: Project; status: ReviewStatus }>;
  isLoading: boolean;
};

export function useMarkReviewed(): UseMutationResult<Project, Error, { projectId: number }>;

export function useSetReviewCadence(): UseMutationResult<
  Project, Error,
  { projectId: number; cadenceDays: number | null } // null = clear override
>;

export function useExcludeFromReview(): UseMutationResult<
  Project, Error,
  { projectId: number; excluded: boolean }
>;
```

`useProjectsNeedingReview` selects from the existing `useProjects()` cache:
1. Fetch global default cadence from AppConfig via `useConfig()`.
2. Read inbox project ID + `review.exclude_inbox` flag from config.
3. For each non-archived project: parse metadata, compute status.
4. Filter: keep only `isOverdue && state !== 'excluded'`. Drop inbox if configured to exclude.
5. Sort: most-overdue first (`daysUntilDue` ascending, with `null` last).

All mutations:
- Read current project from cache via `queryClient.getQueryData(['projects'])`.
- Compute new description via `upsertFooter`.
- Reuse the existing project-update mutation hook (planner: verify exact file name — likely `src/renderer/hooks/use-project-mutations.ts` mirroring `use-task-mutations.ts`). It MUST send the complete Project object to avoid the Go zero-value gotcha at `src/main/api-client.ts:198`. If no such hook exists, follow the pattern in `useUpdateTask` (`use-task-mutations.ts:131-278`) one-for-one against the project endpoint.
- Optimistic update: patch the description in the projects cache. Rollback on error per existing pattern.
- Show toast on success (`useToast` if available — check existing patterns in mutation hooks; otherwise no-op).

### 5.3 `src/renderer/views/ReviewView.tsx`

Renders the "Review" smart list. Layout mirrors `Anytime.tsx` (verify exact file name during implementation) but operates on projects rather than tasks.

The view has two tabs / segmented-control modes, both always accessible:
- **Due** (default): overdue projects only.
- **All tracked**: every non-archived, non-excluded project regardless of overdue status, sorted by `daysUntilDue` ascending.

Header:
- Title "Review"
- Subtitle, Due mode: "{N} project(s) due for review" or "All caught up — no projects due for review" when N=0.
- Subtitle, All-tracked mode: "{N} tracked project(s)".
- Segmented control or tab strip switching the two modes.

Body (both modes):
- LazyList of rows. One row per project, sorted as above.
- Row content (`ReviewListRow`):
  - Project name (clickable → navigates to existing `/project/$projectId`).
  - Status pill: `Never reviewed` (red), `Overdue by Nd` (red), `Due today` (amber), `Due in Nd` (gray, only appears in All-tracked mode).
  - Last-reviewed timestamp in muted text: `Reviewed 18 days ago` or `Never reviewed`.
  - Primary action button: `Mark reviewed`. Available regardless of overdue status (marking a not-yet-overdue project is valid — it resets the clock). Single click, fires `useMarkReviewed`. Button disables and shows a brief spinner state during the mutation.
  - Secondary action (overflow `…` menu):
    - `Set cadence…` → opens a small popover with a number input (days) + Save/Clear-override.
    - `Exclude from review tracking` → confirmation, then fires `useExcludeFromReview`.

Empty state, Due mode with N=0:
- Centered empty state with a checkmark glyph and "All caught up — switch to All tracked to manage cadence on individual projects."

### 5.4 `src/renderer/components/sidebar/SmartListNav.tsx` change

Add a new entry to the `smartLists` array (per Explore findings, file path was `SmartListNav.tsx:14-20`):

```typescript
{
  id: 'review',
  label: 'Review',
  icon: RefreshCw, // from lucide-react
  path: '/review',
  iconColor: 'text-violet-500',
}
```

Position: between `Anytime` and `Logbook`. Reads "above the line" with active work, since reviewing is a proactive activity, not historical.

Badge: append the overdue count to the entry when > 0. Pattern: reuse whatever badge component the Inbox count uses (verify exact name during implementation, e.g., `SidebarBadge`). Read count from `useProjectsNeedingReview().data.length`.

### 5.5 `src/renderer/views/SettingsView.tsx` change

Add a new section component `ReviewSettingsPanel` in the `general` tab (matches where `notifications_default_reminder_*` settings live per `src/main/config.ts:81-82`).

Panel contents:
- Header: "Review"
- Toggle: "Enable project review tracking" → `review.enabled`. Default `true`. When off, the sidebar entry is hidden and `useProjectsNeedingReview` short-circuits to empty.
- Number input: "Default review cadence (days)" → `review.default_cadence_days`. Default 14. Min 1, max 365. Inline help: "How often projects should be reviewed unless overridden per project."
- Toggle: "Exclude Inbox from review list" → `review.exclude_inbox`. Default `true`. Inline help: "Your Inbox is for capture, not for periodic review."

### 5.6 `src/renderer/router.tsx` change

Add the route per existing pattern (Explore findings showed routes at `router.tsx:36-105`):

```typescript
const reviewRoute = createRoute({
  getParentRoute: () => rootRoute, // match neighboring routes
  path: '/review',
  component: ReviewView,
});

// add reviewRoute to routeTree alongside todayRoute, logbookRoute, etc.
```

## 6. Settings persistence

Extend `AppConfig` in `src/main/config.ts`:

```typescript
export interface AppConfig {
  // ...existing fields...
  review?: {
    enabled: boolean;             // default true
    default_cadence_days: number; // default 14
    exclude_inbox: boolean;       // default true
  };
}
```

Migration:
- Existing configs without `review` get the defaults at read time. Do NOT mutate the file on load — let the auto-save flow write it on the next user-triggered settings change (matches existing pattern for newly added fields).
- No version bump required.

## 7. Mutation contract & idempotency

Every mutation that touches a project's description **must** read the latest project from cache (or force-refresh), apply `upsertFooter`, and send the **complete project object** via the existing `updateProject` IPC. Sending only `{ description }` will zero out other fields per the Go zero-value gotcha documented at `src/main/api-client.ts:198` and `src/main/api-client.ts:306-316`.

Idempotency:
- `useMarkReviewed` for a project whose marker already says "reviewed today" performs no write (computed marker == current marker — see Section 3 "Serialization rules" step 3).
- Concurrent reviews from two clients: last writer wins (Vikunja semantics). Acceptable — the only mutation is the timestamp, and "last reviewed" being the more recent of two clicks is the correct behavior.

## 8. Edge cases

| Case | Behavior |
|------|----------|
| Project description is `null` or `undefined` | Treat as empty string. On write, replace with `"\n---\n**Vicu review**: ..."`. |
| Project description has multiple `---` separators (user uses horizontal rules) | Only the final occurrence followed by `**Vicu review**:` matches. |
| Project description has a malformed marker (`**Vicu review**: garbage`) | Log warning, treat as untracked-default. Preserve the malformed text. Next mark-reviewed write will REPLACE it (since `upsertFooter` strips the whole `\n---\n**Vicu review**: ...` tail unconditionally — this is intentional: we trust the user is okay with us cleaning up garbage they didn't ask for). |
| Project description ends with marker followed by trailing whitespace | Tolerated by parser. `upsertFooter` rewrites without trailing whitespace. |
| Archived project | Filtered out of the review list (read `is_archived` from project). Marker is preserved in the description but invisible to the workflow. Unarchiving restores it to the list. |
| Inbox project (per `AppConfig.inbox_project_id`) | Filtered out when `review.exclude_inbox` is `true` (default). |
| Project with no description (truly empty) | Initial marker is just `"---\n**Vicu review**: 2026-05-24 · every 14 days"` — no leading newlines needed. |
| User has 0 projects | Review view shows empty state. Sidebar badge is hidden. |
| Standalone mode (no Vikunja server, per `src/main/cache.ts`) | Works identically. The cache is the source of truth in standalone mode and supports the same mutation surface. |
| Offline | The mutation is queued via existing `PendingAction` mechanism. UI shows optimistic state. Marker may briefly disagree across devices until sync. |
| Vikunja returns 5xx on update | Existing `useUpdateProject` rollback applies. Toast surfaces error. User can retry. |

## 9. Testing

Vicu has no test runner per `CLAUDE.md`. The feature ships untested at the unit level. Manual verification checklist for the PR:

1. With a fresh Vikunja project (no description): mark reviewed → description becomes `---\n**Vicu review**: 2026-05-24 · every 14 days`. Verify in Vikunja web UI.
2. With a project that has a description: mark reviewed → marker appended; original description untouched.
3. Mark reviewed twice in a row: no double-write (check network panel — second click sends no HTTP request).
4. Set per-project cadence to 7 days → marker becomes `... · every 7 days`. Project re-appears 7 days after last review (mock by editing the date manually in Vikunja web UI).
5. Exclude a project → falls off the review list immediately. Marker becomes `**Vicu review**: excluded`.
6. Archive a tracked project → falls off list. Unarchive → reappears with prior state.
7. Inbox project: with `exclude_inbox = true`, never appears even if it has a stale marker. With `false`, appears.
8. Settings toggle "Enable project review tracking" off → sidebar entry hidden, no work done in the background.
9. Standalone mode: same 1–8 work locally.
10. Offline: mark reviewed → optimistic update, mutation queued. Restore network → mutation drains.

If a lightweight test runner is later added, the highest-value unit tests would target `review-metadata.ts` (`parseReviewFooter`, `upsertFooter`, `computeStatus`) — they're pure and have many edge cases.

## 10. Out of scope (deferred)

- Per-project review notes / log (a multi-line history of past reviews). The marker as designed holds only the latest. If we want a log, encode as additional lines after the marker; revisit after MVP usage.
- Review reminders (push notifications when a project becomes overdue).
- An "ambient" mark-reviewed button on individual project views. Explicitly rejected during brainstorming in favor of a single dedicated surface.
- Custom-list integration ("create a custom list of all projects with cadence < 7 days"). Possible later if users want it.

## 11. File-by-file change list

**New files:**
- `src/renderer/lib/review-metadata.ts`
- `src/renderer/hooks/use-review.ts`
- `src/renderer/views/ReviewView.tsx`
- `src/renderer/components/review/ReviewListRow.tsx`
- `src/renderer/components/review/ReviewSettingsPanel.tsx`

**Edited files:**
- `src/main/config.ts` — add `review` to `AppConfig`, defaults.
- `src/renderer/components/sidebar/SmartListNav.tsx` — add Review entry + badge.
- `src/renderer/router.tsx` — add `/review` route.
- `src/renderer/views/SettingsView.tsx` — mount `ReviewSettingsPanel` in general tab.

No changes to: `src/main/api-client.ts`, any preload script, any existing project mutation hook.

## 12. Open questions for the planner

- The badge component used by Inbox: needs lookup during implementation. If none exists, decide whether to introduce one or use inline text in the smart-list entry.
- Toast/notification pattern: verify what existing mutations do on success/failure. If there's no toast system, mutations should fail silently with a console error and the optimistic rollback as the only user-visible signal.
- Icon choice (`RefreshCw` is a reasonable default but the project may prefer something else — `ClipboardCheck`, `RotateCw`, `Eye`).
