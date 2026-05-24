# Vicu Desktop — Project Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Testing note:** Vicu has no test runner configured (per CLAUDE.md). This plan substitutes a `npm run build` typecheck + targeted manual verification for the usual TDD red-green cycle. Each task ends with a typecheck and a commit. The final task (Task 10) runs the full manual verification matrix from the spec.

> **Plan location note:** This plan was authored at the harness path `~/.claude/plans/`. After approval, copy it to `vicu/docs/superpowers/plans/2026-05-24-project-review-desktop-plan.md` so it lives with the spec.

**Goal:** Add a GTD-style project review workflow to Vicu Desktop. Parses a marker footer at the end of each Vikunja project's `description`, surfaces overdue projects in a new "Review" sidebar smart list, lets the user mark them reviewed with one click. Review state syncs via Vikunja so the Android client and an MCP-based agent see the same data.

**Architecture:** Renderer-only feature on top of the existing project endpoint. New pure parser library in `src/renderer/lib/`, new TanStack Query hooks (the first project-mutation hook in the codebase, mirroring `useUpdateTask`), new view + components, sidebar/router/settings wiring, and an `AppConfig.review` schema addition. No main-process changes beyond the config schema; `src/main/api-client.ts` is untouched.

**Tech Stack:** TypeScript, React 18, TanStack Query, TanStack Router (hash history), Tailwind CSS, Zustand, lucide-react icons. Vite for dev/build.

**Companion design spec:** `vicu/docs/superpowers/specs/2026-05-24-project-review-design.md`

---

## Context

The user is a GTD practitioner. They want every Vikunja project reviewed at least every two weeks, with the ability to see which projects are due and mark them reviewed with one click. Vikunja has no native "last reviewed" field — verified against the OpenAPI spec at `api-docs.json:8216-8299` — and the only writable structured fields on a project are `title`, `description`, `identifier` (≤10 chars), and `hex_color` (≤7 chars). The blessed workaround from the Vikunja maintainer (per the [project-notes feature thread](https://community.vikunja.io/t/project-specific-notes/2929)) is to use the description.

We encode review state as a plaintext footer at the end of the description, marker-prefixed `**Vicu review**:`. The format is human-readable (the user can see it in the Vikunja web UI without Vicu installed), parseable by any LLM agent, and survives sync without server-side changes.

This plan covers the Vicu Desktop client only. Companion plans for `vicu-android` and `vikunja-mcp` are out of scope here but will follow the same marker grammar (Section "Marker grammar" below — mirrored from the spec).

---

## File map

**New files (6):**
- `src/renderer/lib/review-metadata.ts` — pure parser/serializer/status computer
- `src/renderer/hooks/use-project-mutations.ts` — `useUpdateProject` (first project mutation hook in the codebase)
- `src/renderer/hooks/use-review.ts` — `useProjectsNeedingReview`, `useTrackedProjects`, `useMarkReviewed`, `useSetReviewCadence`, `useExcludeFromReview`, `useReviewBadgeCount`
- `src/renderer/views/ReviewView.tsx` — the smart-list view with Due / All-tracked tabs
- `src/renderer/components/review/ReviewListRow.tsx` — one row in the list
- `src/renderer/components/review/ReviewSettingsPanel.tsx` — settings UI

**Edited files (4):**
- `src/main/config.ts` — add `AppConfig.review` field, defaults, normalization
- `src/renderer/components/sidebar/SmartListNav.tsx` — add Review entry + introduce the first badge
- `src/renderer/router.tsx` — add `/review` route
- `src/renderer/views/SettingsView.tsx` — mount `ReviewSettingsPanel` in the general tab

**No changes to:** `src/main/api-client.ts`, any preload script, any existing hook.

---

## Marker grammar (canonical)

Reproduced from the spec — the parser implementation in Task 2 must match this exactly.

```
{user's existing description, may be empty or multiline}

---
**Vicu review**: <value>
```

**Values:**

| Form | Meaning |
|------|---------|
| `2026-05-24 · every 14 days` | Last reviewed on date; per-project cadence override of 14 days. |
| `2026-05-24` | Last reviewed on date; uses global default cadence. |
| `excluded` | Project opts out of review tracking. Never appears in the review list. |
| `never · every 7 days` | Tracked with cadence override but not yet reviewed. Treated as overdue immediately. |
| (no marker) | Default: tracked, never reviewed, uses global default cadence. Treated as overdue immediately. |

**Reserved tokens:** `**Vicu review**:` exact prefix, `·` (U+00B7) primary separator, ` | ` accepted on read, `never`/`excluded` case-insensitive on read.

**Disambiguation:** marker recognized only when `\n---\n` is followed immediately by `**Vicu review**: `. Other horizontal rules in the description are ignored.

---

## Tasks

### Task 1: AppConfig schema for review settings

**Files:**
- Modify: `src/main/config.ts:21-110` (AppConfig interface, DEFAULT_CONFIG, normalizeConfig)
- Modify: `src/renderer/lib/vikunja-types.ts:169` (renderer-side AppConfig duplicate — both must stay in sync)

`AppConfig` is duplicated between main and renderer (verified — there is no shared types package). Both interfaces must gain the `review` field; otherwise the renderer's TypeScript won't know about it.

- [ ] **Step 1a: Add `ReviewConfig` interface and field to main's `AppConfig`**

In `src/main/config.ts`, add this interface above `AppConfig`:

```typescript
export interface ReviewConfig {
  enabled: boolean
  default_cadence_days: number
  exclude_inbox: boolean
}
```

Then add the optional field to `AppConfig` (alongside existing fields):

```typescript
export interface AppConfig {
  // ...existing fields untouched...
  review?: ReviewConfig
}
```

- [ ] **Step 1b: Mirror the addition in the renderer's `AppConfig`**

In `src/renderer/lib/vikunja-types.ts`, near `AppConfig` (line 169), add:

```typescript
export interface ReviewConfig {
  enabled: boolean
  default_cadence_days: number
  exclude_inbox: boolean
}
```

And add the field to the existing `AppConfig`:

```typescript
export interface AppConfig {
  // ...existing fields...
  review?: ReviewConfig
}
```

- [ ] **Step 2: Add default to `DEFAULT_CONFIG`**

In the `DEFAULT_CONFIG` constant (around line 105-110):

```typescript
const DEFAULT_CONFIG: AppConfig = {
  // ...existing fields untouched...
  review: {
    enabled: true,
    default_cadence_days: 14,
    exclude_inbox: true,
  },
}
```

- [ ] **Step 3: Add normalization in `normalizeConfig`**

In `normalizeConfig` (around line 149-234), add a normalization block. Find the end of the existing field normalizations, then add:

```typescript
const rawReview = (raw as Record<string, unknown>).review
const reviewSource = (rawReview && typeof rawReview === 'object')
  ? rawReview as Record<string, unknown>
  : {}

function clampCadenceDays(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 14
  return Math.min(365, Math.max(1, Math.round(n)))
}

const review: ReviewConfig = {
  enabled: typeof reviewSource.enabled === 'boolean' ? reviewSource.enabled : true,
  default_cadence_days: clampCadenceDays(reviewSource.default_cadence_days),
  exclude_inbox: typeof reviewSource.exclude_inbox === 'boolean' ? reviewSource.exclude_inbox : true,
}
```

(The `clampCadenceDays` helper is local to this block; if you find similar numeric coercion helpers already in the file, factor it up.)

Then add `review` to the returned config object.

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/config.ts src/renderer/lib/vikunja-types.ts
git commit -m "feat(config): add review settings schema with defaults"
```

---

### Task 2: Review metadata parser library

**Files:**
- Create: `src/renderer/lib/review-metadata.ts`

This is the heart of the feature. Pure functions, no imports beyond standard libs.

- [ ] **Step 1: Create the file with full implementation**

```typescript
// src/renderer/lib/review-metadata.ts
// Pure functions for parsing, serializing, and reasoning about the review
// marker that lives at the end of Vikunja project descriptions.
//
// Marker grammar:
//   <description>\n\n---\n**Vicu review**: <date|never|excluded>[ · every N days]
//
// See vicu/docs/superpowers/specs/2026-05-24-project-review-design.md §3.

export const REVIEW_MARKER_PREFIX = '**Vicu review**:'
export const REVIEW_MARKER_SEPARATOR = '---'
export const REVIEW_MIDDLE_DOT = '·' // ·

export type ReviewState = 'never' | 'reviewed' | 'excluded'

export interface ReviewMetadata {
  state: ReviewState
  lastReviewedAt: string | null   // 'YYYY-MM-DD', null unless state === 'reviewed'
  cadenceDaysOverride: number | null
}

export interface ReviewStatus {
  metadata: ReviewMetadata
  effectiveCadenceDays: number
  nextReviewAt: Date | null
  isOverdue: boolean
  daysSinceReviewed: number | null
  daysUntilDue: number | null
}

// Matches \n---\n**Vicu review**: <value> at end-of-string. The leading
// (?:^|\n) handles both:
//   - "hello\n---\n**Vicu review**: ..."       (description with body)
//   - "---\n**Vicu review**: ..."              (empty-body case, no leading \n)
// Without `g`, .match() returns the leftmost match; because the regex anchors
// at end-of-string ($) and . doesn't cross newlines, only the FINAL marker
// block in the description can match — so multi-marker descriptions resolve
// to the last one, per spec.
const MARKER_REGEX = /(?:^|\n)---\s*\n\*\*Vicu review\*\*:\s*(.+?)\s*$/

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const CADENCE_REGEX = /^every\s+(\d+)\s*(d|day|days|w|week|weeks)$/i

function defaultMeta(): ReviewMetadata {
  return { state: 'never', lastReviewedAt: null, cadenceDaysOverride: null }
}

export function parseReviewFooter(description: string | null | undefined): ReviewMetadata {
  if (!description) return defaultMeta()
  const match = description.match(MARKER_REGEX)
  if (!match) return defaultMeta()
  const value = match[1].trim()
  // Split on · (preferred) or ' | ' (read-only fallback)
  const parts = value.split(/\s*·\s*|\s+\|\s+/).map((p) => p.trim())
  const [first, second] = parts

  let state: ReviewState
  let lastReviewedAt: string | null = null
  if (/^excluded$/i.test(first)) {
    state = 'excluded'
  } else if (/^never$/i.test(first)) {
    state = 'never'
  } else if (ISO_DATE.test(first)) {
    state = 'reviewed'
    lastReviewedAt = first
  } else {
    // Malformed — preserve user's text by treating as defaultMeta. Caller
    // decides whether to surface a warning.
    console.warn('[review-metadata] malformed marker value:', value)
    return defaultMeta()
  }

  let cadenceDaysOverride: number | null = null
  if (second) {
    const cadenceMatch = second.match(CADENCE_REGEX)
    if (cadenceMatch) {
      const n = parseInt(cadenceMatch[1], 10)
      const unit = cadenceMatch[2].toLowerCase()
      cadenceDaysOverride = unit.startsWith('w') ? n * 7 : n
    } else {
      console.warn('[review-metadata] malformed cadence segment:', second)
    }
  }

  return { state, lastReviewedAt, cadenceDaysOverride }
}

export function serializeReviewFooter(meta: ReviewMetadata): string {
  if (meta.state === 'excluded') return `${REVIEW_MARKER_PREFIX} excluded`
  const head = meta.state === 'reviewed' && meta.lastReviewedAt ? meta.lastReviewedAt : 'never'
  if (meta.cadenceDaysOverride && meta.cadenceDaysOverride > 0) {
    return `${REVIEW_MARKER_PREFIX} ${head} ${REVIEW_MIDDLE_DOT} every ${meta.cadenceDaysOverride} days`
  }
  return `${REVIEW_MARKER_PREFIX} ${head}`
}

export function stripFooter(description: string | null | undefined): string {
  if (!description) return ''
  // Strip the LAST occurrence of \n---\n**Vicu review**: ... to end.
  // Also tolerate the description ending in just the marker block.
  return description.replace(MARKER_REGEX, '').replace(/\s+$/, '')
}

export function upsertFooter(description: string | null | undefined, meta: ReviewMetadata): string {
  const body = stripFooter(description)
  const footer = `---\n${serializeReviewFooter(meta)}`
  if (body.length === 0) return footer
  return `${body}\n\n${footer}`
}

// today defaults to a fresh new Date(); pass in tests for determinism.
export function computeStatus(
  meta: ReviewMetadata,
  globalDefaultCadenceDays: number,
  today: Date = new Date()
): ReviewStatus {
  const effectiveCadenceDays = meta.cadenceDaysOverride ?? globalDefaultCadenceDays
  const todayUtc = utcMidnight(today)

  if (meta.state === 'excluded') {
    return {
      metadata: meta,
      effectiveCadenceDays,
      nextReviewAt: null,
      isOverdue: false,
      daysSinceReviewed: null,
      daysUntilDue: null,
    }
  }

  if (meta.state === 'never' || !meta.lastReviewedAt) {
    return {
      metadata: meta,
      effectiveCadenceDays,
      nextReviewAt: null,
      isOverdue: true,
      daysSinceReviewed: null,
      daysUntilDue: null,
    }
  }

  const last = parseIsoDateUtc(meta.lastReviewedAt)
  const next = new Date(last)
  next.setUTCDate(next.getUTCDate() + effectiveCadenceDays)
  const daysSince = daysBetween(todayUtc, last)
  const daysUntil = daysBetween(next, todayUtc)
  return {
    metadata: meta,
    effectiveCadenceDays,
    nextReviewAt: next,
    isOverdue: daysUntil < 0,
    daysSinceReviewed: daysSince,
    daysUntilDue: daysUntil,
  }
}

// Helpers — kept inside the module since no shared util exists yet.

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function parseIsoDateUtc(s: string): Date {
  // s is 'YYYY-MM-DD'
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10))
  return new Date(Date.UTC(y, m - 1, d))
}

function daysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 86_400_000
  return Math.round((a.getTime() - b.getTime()) / MS_PER_DAY)
}

// Convenience for formatting today's date in the user's local timezone.
// Used by useMarkReviewed when constructing the new marker.
export function todayLocalIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Convenience for the UI's "Reviewed N days ago" / "Never reviewed" line.
export function formatLastReviewedLabel(status: ReviewStatus): string {
  if (status.metadata.state === 'excluded') return 'Excluded from review'
  if (status.metadata.state === 'never') return 'Never reviewed'
  const days = status.daysSinceReviewed ?? 0
  if (days === 0) return 'Reviewed today'
  if (days === 1) return 'Reviewed yesterday'
  return `Reviewed ${days} days ago`
}

// Convenience for the status pill.
export function formatStatusPill(status: ReviewStatus): { label: string; tone: 'red' | 'amber' | 'gray' | 'gray-muted' } {
  if (status.metadata.state === 'excluded') return { label: 'Excluded', tone: 'gray-muted' }
  if (status.metadata.state === 'never') return { label: 'Never reviewed', tone: 'red' }
  const d = status.daysUntilDue ?? 0
  if (d < 0) return { label: `Overdue ${Math.abs(d)}d`, tone: 'red' }
  if (d === 0) return { label: 'Due today', tone: 'amber' }
  return { label: `Due in ${d}d`, tone: 'gray' }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Sanity-check parser in a scratch node REPL (optional but recommended)**

Open a temporary `scratch.ts` (do NOT commit), import the parser, and verify a few cases:

```typescript
import { parseReviewFooter, upsertFooter, computeStatus } from './src/renderer/lib/review-metadata'
console.log(parseReviewFooter('hello\n\n---\n**Vicu review**: 2026-05-24 · every 7 days'))
// → { state: 'reviewed', lastReviewedAt: '2026-05-24', cadenceDaysOverride: 7 }

console.log(upsertFooter('hello world', { state: 'reviewed', lastReviewedAt: '2026-05-24', cadenceDaysOverride: null }))
// → 'hello world\n\n---\n**Vicu review**: 2026-05-24'

console.log(upsertFooter('', { state: 'excluded', lastReviewedAt: null, cadenceDaysOverride: null }))
// → '---\n**Vicu review**: excluded'

console.log(computeStatus(
  { state: 'reviewed', lastReviewedAt: '2026-05-10', cadenceDaysOverride: null },
  14,
  new Date('2026-05-24T12:00:00Z'),
))
// → { ..., daysSinceReviewed: 14, daysUntilDue: 0, isOverdue: false }
```

Delete `scratch.ts` after. If any case is wrong, fix `review-metadata.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/lib/review-metadata.ts
git commit -m "feat(lib): add review-metadata parser and status computer"
```

---

### Task 3: `useUpdateProject` mutation hook

**Files:**
- Create: `src/renderer/hooks/use-project-mutations.ts`

No existing project mutation hook exists in the codebase. We're creating the first one. Mirror `useUpdateTask` from `src/renderer/hooks/use-task-mutations.ts:131-278`. Cache key for projects is `['projects']` (per `src/renderer/hooks/use-projects.ts:35-48`).

- [ ] **Step 1: Create the file**

```typescript
// src/renderer/hooks/use-project-mutations.ts
// Project mutations. Currently exposes only useUpdateProject, which the
// review feature uses to write the marker footer into project.description.
//
// CRITICAL: Vikunja has the Go zero-value problem — sending only changed
// fields zeros out everything else. Always pass the COMPLETE project.
// See src/main/api-client.ts:306 for the equivalent comment on tasks.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Project } from '@/lib/vikunja-types'

export interface UpdateProjectVars {
  id: number
  project: Project // full project object — required for Go zero-value safety
}

export function useUpdateProject() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, project }: UpdateProjectVars) => {
      // Pass the project through unchanged. Unlike useUpdateTask (which strips
      // `position` because task position is per-view and managed separately),
      // Project.position IS updated via the standard project endpoint, so
      // there's nothing to strip. Vikunja ignores read-only fields like
      // `created` and `updated` server-side.
      const result = await api.updateProject(id, project)
      if (!result.success) throw new Error(result.error)
      return result.data as Project
    },
    onMutate: async ({ id, project }) => {
      await qc.cancelQueries({ queryKey: ['projects'] })
      const previousProjects = qc.getQueryData<Project[]>(['projects'])
      if (previousProjects) {
        qc.setQueryData<Project[]>(
          ['projects'],
          previousProjects.map((p) => (p.id === id ? project : p)),
        )
      }
      return { previousProjects }
    },
    onError: (err, _vars, context) => {
      if (context?.previousProjects) {
        qc.setQueryData(['projects'], context.previousProjects)
      }
      console.error('[useUpdateProject] mutation failed:', err)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: build succeeds. If `api.updateProject` complains about types — `UpdateProjectPayload` is currently typed with optional fields (per `src/renderer/lib/vikunja-types.ts:101-108`), and `Project` has required fields. The full `Project` matches the `UpdateProjectPayload` shape structurally (TypeScript is fine with a wider type passed to a narrower expected param via structural typing where all required keys of the target are present). If a type error appears, cast: `api.updateProject(id, project as unknown as UpdateProjectPayload)` and add a `// Go zero-value compliance — see use-project-mutations.ts` comment.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/hooks/use-project-mutations.ts
git commit -m "feat(hooks): add useUpdateProject mutation"
```

---

### Task 4: Review hooks

**Files:**
- Create: `src/renderer/hooks/use-review.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/renderer/hooks/use-review.ts
import { useMemo } from 'react'
import { useProjects } from './use-projects'
import { useAppConfig } from './use-app-config'
import { useUpdateProject } from './use-project-mutations'
import {
  parseReviewFooter,
  computeStatus,
  upsertFooter,
  todayLocalIsoDate,
  type ReviewStatus,
  type ReviewMetadata,
} from '@/lib/review-metadata'
import type { Project, AppConfig } from '@/lib/vikunja-types'

export interface ProjectWithStatus {
  project: Project
  status: ReviewStatus
}

function selectProjects(
  projects: Project[] | undefined,
  cfg: AppConfig | null | undefined,
  predicate: (s: ReviewStatus) => boolean,
): ProjectWithStatus[] {
  if (!projects || !cfg?.review?.enabled) return []
  const defaultCadence = cfg.review.default_cadence_days
  const excludeInbox = cfg.review.exclude_inbox
  const inboxId = cfg.inbox_project_id
  const now = new Date()
  return projects
    .filter((p) => !p.is_archived)
    .filter((p) => !(excludeInbox && p.id === inboxId))
    .map((p): ProjectWithStatus => {
      const meta = parseReviewFooter(p.description)
      const status = computeStatus(meta, defaultCadence, now)
      return { project: p, status }
    })
    .filter(({ status }) => status.metadata.state !== 'excluded' && predicate(status))
    .sort((a, b) => {
      const av = a.status.daysUntilDue ?? Number.MIN_SAFE_INTEGER
      const bv = b.status.daysUntilDue ?? Number.MIN_SAFE_INTEGER
      return av - bv
    })
}

export function useProjectsNeedingReview() {
  const { data: projects, isLoading: projectsLoading } = useProjects()
  const { data: cfg, isLoading: cfgLoading } = useAppConfig()
  const data = useMemo(
    () => selectProjects(projects, cfg, (s) => s.isOverdue),
    [projects, cfg],
  )
  return { data, isLoading: projectsLoading || cfgLoading }
}

export function useTrackedProjects() {
  const { data: projects, isLoading: projectsLoading } = useProjects()
  const { data: cfg, isLoading: cfgLoading } = useAppConfig()
  const data = useMemo(
    () => selectProjects(projects, cfg, () => true),
    [projects, cfg],
  )
  return { data, isLoading: projectsLoading || cfgLoading }
}

// Cheap selector for the sidebar badge. Returns the overdue count or 0 when
// review tracking is disabled. Hidden / Inbox excluded already applied.
export function useReviewBadgeCount(): number {
  const { data } = useProjectsNeedingReview()
  return data.length
}

// Used by SmartListNav to decide whether to render the Review entry at all.
export function useReviewFeatureEnabled(): boolean {
  const { data: cfg } = useAppConfig()
  // Default to enabled when config hasn't loaded yet, to avoid sidebar flicker.
  return cfg?.review?.enabled ?? true
}

// ---- Mutations ----

function applyMetaUpdate(project: Project, mutator: (m: ReviewMetadata) => ReviewMetadata): Project {
  const currentMeta = parseReviewFooter(project.description)
  const nextMeta = mutator(currentMeta)
  const newDescription = upsertFooter(project.description, nextMeta)
  if (newDescription === project.description) return project // no-op marker
  return { ...project, description: newDescription }
}

// Each of the three mutation hooks below is a thin wrapper around
// useUpdateProject that handles the marker-rewrite logic. They preserve the
// underlying mutation's isPending / isError / error fields so the caller can
// drive UI feedback off react-query state. The wrapper's `mutate` redefines
// the variables shape; everything else (isPending, etc.) passes through.

export function useMarkReviewed() {
  const update = useUpdateProject()
  const mutate = (vars: { project: Project }) => {
    const next = applyMetaUpdate(vars.project, (m) => ({
      ...m,
      state: 'reviewed',
      lastReviewedAt: todayLocalIsoDate(),
    }))
    if (next === vars.project) return // marker already current — silent no-op
    update.mutate({ id: vars.project.id, project: next })
  }
  return { ...update, mutate }
}

export function useSetReviewCadence() {
  const update = useUpdateProject()
  const mutate = (vars: { project: Project; cadenceDays: number | null }) => {
    const next = applyMetaUpdate(vars.project, (m) => ({
      ...m,
      cadenceDaysOverride: vars.cadenceDays && vars.cadenceDays > 0 ? vars.cadenceDays : null,
    }))
    if (next === vars.project) return
    update.mutate({ id: vars.project.id, project: next })
  }
  return { ...update, mutate }
}

export function useExcludeFromReview() {
  const update = useUpdateProject()
  const mutate = (vars: { project: Project; excluded: boolean }) => {
    const next = applyMetaUpdate(vars.project, (m) => {
      if (vars.excluded) {
        return { state: 'excluded', lastReviewedAt: null, cadenceDaysOverride: null }
      }
      // un-exclude → drop back to NEVER, keep cadence override if previously set
      return { ...m, state: 'never', lastReviewedAt: null }
    })
    if (next === vars.project) return
    update.mutate({ id: vars.project.id, project: next })
  }
  return { ...update, mutate }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: build succeeds.

Notes:
- `useAppConfig` is the existing hook at `src/renderer/hooks/use-app-config.ts:6-12`. It returns `useQuery<AppConfig | null>` using `APP_CONFIG_QUERY_KEY = ['app-config']` with `staleTime: Infinity`. Shares cache with `SettingsView`, so mutations to config from settings immediately reflect in the review hooks.
- `AppConfig` is exported from `src/renderer/lib/vikunja-types.ts:169` — already verified to include the `review` field once Task 1 is done.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/hooks/use-review.ts
git commit -m "feat(hooks): add review hooks (selectors + mutations)"
```

---

### Task 5: `ReviewListRow` component

**Files:**
- Create: `src/renderer/components/review/ReviewListRow.tsx`

- [ ] **Step 1: Create the file**

```typescript
// src/renderer/components/review/ReviewListRow.tsx
import { useState } from 'react'
import { CheckCircle2, MoreHorizontal, Loader2 } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { formatLastReviewedLabel, formatStatusPill } from '@/lib/review-metadata'
import {
  useMarkReviewed,
  useSetReviewCadence,
  useExcludeFromReview,
  type ProjectWithStatus,
} from '@/hooks/use-review'

interface ReviewListRowProps {
  item: ProjectWithStatus
}

const PILL_TONE: Record<ReturnType<typeof formatStatusPill>['tone'], string> = {
  red: 'bg-red-500/15 text-red-500',
  amber: 'bg-amber-500/15 text-amber-600',
  gray: 'bg-gray-500/15 text-gray-500',
  'gray-muted': 'bg-gray-300/30 text-gray-400',
}

// One mutation instance PER ROW. react-query's useMutation returns a per-call
// independent state, so two rows running mutations concurrently track their
// own isPending without cross-talk. This is the reason mutations live here
// rather than in the parent view.
export function ReviewListRow({ item }: ReviewListRowProps) {
  const { project, status } = item
  const pill = formatStatusPill(status)
  const navigate = useNavigate()
  const mark = useMarkReviewed()
  const setCadence = useSetReviewCadence()
  const exclude = useExcludeFromReview()
  const isMutating = mark.isPending || setCadence.isPending || exclude.isPending

  const [menuOpen, setMenuOpen] = useState(false)
  const [cadenceOpen, setCadenceOpen] = useState(false)
  const [cadenceInput, setCadenceInput] = useState<string>(
    String(status.metadata.cadenceDaysOverride ?? ''),
  )

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
      <button
        type="button"
        className="flex-1 text-left"
        onClick={() => navigate({ to: '/project/$projectId', params: { projectId: String(project.id) } })}
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: project.hex_color || '#888' }}
          />
          <span className="font-medium text-[var(--text-primary)]">{project.title}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${PILL_TONE[pill.tone]}`}>{pill.label}</span>
        </div>
        <div className="text-xs text-[var(--text-secondary)] mt-1">{formatLastReviewedLabel(status)}</div>
      </button>

      <button
        type="button"
        disabled={isMutating}
        onClick={() => mark.mutate({ project })}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--accent-blue)] text-white text-sm font-medium disabled:opacity-50"
      >
        {isMutating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
        Mark reviewed
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="p-1.5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-full mt-1 z-10 w-44 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-lg py-1"
            onMouseLeave={() => setMenuOpen(false)}
          >
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-hover)]"
              onClick={() => { setMenuOpen(false); setCadenceOpen(true) }}
            >
              Set cadence…
            </button>
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-hover)] text-red-500"
              onClick={() => { setMenuOpen(false); exclude.mutate({ project, excluded: true }) }}
            >
              Exclude from review tracking
            </button>
          </div>
        )}
        {cadenceOpen && (
          <div className="absolute right-0 top-full mt-1 z-10 w-52 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-lg p-3 space-y-2">
            <label className="block text-xs text-[var(--text-secondary)]">
              Cadence in days (blank = use default)
            </label>
            <input
              type="number"
              min={1}
              max={365}
              value={cadenceInput}
              onChange={(e) => setCadenceInput(e.target.value)}
              className="w-full px-2 py-1 rounded border border-[var(--border-color)] bg-[var(--bg-primary)]"
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 px-2 py-1 text-sm rounded bg-[var(--accent-blue)] text-white"
                onClick={() => {
                  const n = cadenceInput === '' ? null : parseInt(cadenceInput, 10)
                  setCadence.mutate({ project, cadenceDays: Number.isFinite(n ?? NaN) ? n : null })
                  setCadenceOpen(false)
                }}
              >
                Save
              </button>
              <button
                type="button"
                className="px-2 py-1 text-sm rounded border border-[var(--border-color)]"
                onClick={() => setCadenceOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify CSS variable names**

The Tailwind classes assume `var(--bg-primary)`, `var(--bg-hover)`, `var(--border-color)`, `var(--text-primary)`, `var(--text-secondary)`, `var(--accent-blue)`. Per CLAUDE.md these are defined globally; verified against `SettingsView.tsx` and `SmartListNav.tsx` usage. Open `src/renderer/index.css` (or equivalent global stylesheet) only if a build-time warning surfaces — these names should all resolve.

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/review/ReviewListRow.tsx
git commit -m "feat(review): add ReviewListRow component"
```

---

### Task 6: `ReviewView`

**Files:**
- Create: `src/renderer/views/ReviewView.tsx`

- [ ] **Step 1: Create the file**

```typescript
// src/renderer/views/ReviewView.tsx
import { useState } from 'react'
import { RefreshCw, CheckCircle2 } from 'lucide-react'
import { useProjectsNeedingReview, useTrackedProjects } from '@/hooks/use-review'
import { ReviewListRow } from '@/components/review/ReviewListRow'

type Tab = 'due' | 'all'

export function ReviewView() {
  const [tab, setTab] = useState<Tab>('due')
  const due = useProjectsNeedingReview()
  const all = useTrackedProjects()

  const list = tab === 'due' ? due.data : all.data
  const isLoading = tab === 'due' ? due.isLoading : all.isLoading

  return (
    <div className="flex flex-col h-full">
      <header className="px-6 pt-6 pb-3 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-violet-500" />
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Review</h1>
        </div>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          {tab === 'due'
            ? `${due.data.length} project${due.data.length === 1 ? '' : 's'} due for review`
            : `${all.data.length} tracked project${all.data.length === 1 ? '' : 's'}`}
        </p>
        <div className="flex gap-1 mt-3" role="tablist">
          <TabButton active={tab === 'due'} onClick={() => setTab('due')}>Due</TabButton>
          <TabButton active={tab === 'all'} onClick={() => setTab('all')}>All tracked</TabButton>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-6 text-sm text-[var(--text-secondary)]">Loading…</div>
        )}
        {!isLoading && list.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
            <CheckCircle2 className="w-12 h-12 text-green-500 mb-3" />
            <p className="text-[var(--text-primary)] font-medium">
              {tab === 'due' ? 'All caught up' : 'No tracked projects'}
            </p>
            <p className="text-sm text-[var(--text-secondary)] mt-1 max-w-sm">
              {tab === 'due'
                ? 'No projects due for review. Switch to All tracked to manage cadence on individual projects.'
                : 'No non-archived projects to track. If review tracking is disabled in settings, enable it to see projects here.'}
            </p>
          </div>
        )}
        {!isLoading && list.map((item) => (
          <ReviewListRow key={item.project.id} item={item} />
        ))}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        'px-3 py-1.5 rounded-md text-sm font-medium ' +
        (active
          ? 'bg-[var(--accent-blue)] text-white'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]')
      }
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/views/ReviewView.tsx
git commit -m "feat(review): add ReviewView with Due/All-tracked tabs"
```

---

### Task 7: Router wiring — `/review` route

**Files:**
- Modify: `src/renderer/router.tsx`

Verified line locations (read the file before editing to confirm they haven't drifted):
- Existing smart-list routes: `inboxRoute` ~ line 30, `todayRoute` ~ 36, `upcomingRoute` ~ 42, `anytimeRoute` ~ 48, `logbookRoute` ~ 54.
- `routeTree = rootRoute.addChildren([...])` at line 93.

- [ ] **Step 1: Import `ReviewView` and add the route**

In `src/renderer/router.tsx`, add to the import block:

```typescript
import { ReviewView } from './views/ReviewView'
```

Between `anytimeRoute` (line ~48-52) and `logbookRoute` (line ~54-58), add:

```typescript
const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/review',
  component: ReviewView,
})
```

- [ ] **Step 2: Add to `routeTree`**

In the `rootRoute.addChildren([...])` call (starts at line 93), add `reviewRoute` to the array between `anytimeRoute` and `logbookRoute` (matches the smart-list ordering decision in Task 8).

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: build succeeds. Navigating to `#/review` in the browser dev mode should render the view (a quick smoke-check before committing — start `npm run dev`, then visit `#/review` once and confirm it doesn't 404, then stop the dev server).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/router.tsx
git commit -m "feat(router): add /review route"
```

---

### Task 8: SmartListNav entry with badge

**Files:**
- Modify: `src/renderer/components/sidebar/SmartListNav.tsx` (full file ~50 lines; the cleanest path is a full replace)

This introduces the first sidebar badge and the first feature-gated smart-list entry. Per Explore findings, no badge component exists — we inline the badge as a minimal `<span>`. Generalizing is YAGNI until a second use case appears. The existing file as of Task 0:

```typescript
// Current src/renderer/components/sidebar/SmartListNav.tsx (verbatim, for reference)
import { useNavigate, useMatches } from '@tanstack/react-router'
import { Inbox, Sun, Calendar, Layers, BookOpen } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { LucideIcon } from 'lucide-react'

interface SmartListItem { id: string; label: string; icon: LucideIcon; path: string; iconColor: string }

const smartLists: SmartListItem[] = [
  { id: 'inbox', label: 'Inbox', icon: Inbox, path: '/inbox', iconColor: 'text-accent-blue' },
  { id: 'today', label: 'Today', icon: Sun, path: '/today', iconColor: 'text-accent-red' },
  { id: 'upcoming', label: 'Upcoming', icon: Calendar, path: '/upcoming', iconColor: 'text-accent-orange' },
  { id: 'anytime', label: 'Anytime', icon: Layers, path: '/anytime', iconColor: 'text-[#5AC8FA]' },
  { id: 'logbook', label: 'Logbook', icon: BookOpen, path: '/logbook', iconColor: 'text-accent-green' },
]

// ...render loop with .map() over smartLists, no badges...
```

- [ ] **Step 1: Replace the file with the badge-enabled version**

```typescript
// src/renderer/components/sidebar/SmartListNav.tsx
import { useNavigate, useMatches } from '@tanstack/react-router'
import { Inbox, Sun, Calendar, Layers, BookOpen, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { LucideIcon } from 'lucide-react'
import { useReviewBadgeCount, useReviewFeatureEnabled } from '@/hooks/use-review'

interface SmartListItem {
  id: string
  label: string
  icon: LucideIcon
  path: string
  iconColor: string
}

const ALL_SMART_LISTS: SmartListItem[] = [
  { id: 'inbox', label: 'Inbox', icon: Inbox, path: '/inbox', iconColor: 'text-accent-blue' },
  { id: 'today', label: 'Today', icon: Sun, path: '/today', iconColor: 'text-accent-red' },
  { id: 'upcoming', label: 'Upcoming', icon: Calendar, path: '/upcoming', iconColor: 'text-accent-orange' },
  { id: 'anytime', label: 'Anytime', icon: Layers, path: '/anytime', iconColor: 'text-[#5AC8FA]' },
  { id: 'review', label: 'Review', icon: RefreshCw, path: '/review', iconColor: 'text-violet-500' },
  { id: 'logbook', label: 'Logbook', icon: BookOpen, path: '/logbook', iconColor: 'text-accent-green' },
]

export function SmartListNav() {
  const navigate = useNavigate()
  const matches = useMatches()
  const currentPath = matches[matches.length - 1]?.pathname ?? ''
  const reviewEnabled = useReviewFeatureEnabled()

  const items = reviewEnabled
    ? ALL_SMART_LISTS
    : ALL_SMART_LISTS.filter((i) => i.id !== 'review')

  return (
    <nav className="flex flex-col gap-0.5 px-2 py-2">
      {items.map((item) => {
        const isActive = currentPath === item.path
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => navigate({ to: item.path })}
            className={cn(
              'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
              isActive
                ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]'
                : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            )}
          >
            <item.icon className={cn('h-4 w-4 shrink-0', item.iconColor)} strokeWidth={1.8} />
            <span className="flex-1 text-left">{item.label}</span>
            {item.id === 'review' ? <ReviewBadge /> : null}
          </button>
        )
      })}
    </nav>
  )
}

function ReviewBadge() {
  const count = useReviewBadgeCount()
  if (count <= 0) return null
  return (
    <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-xs font-medium bg-violet-500/20 text-violet-500">
      {count}
    </span>
  )
}
```

Key changes from the original:
- Added `RefreshCw` import and `useReviewBadgeCount` / `useReviewFeatureEnabled` imports.
- Renamed `smartLists` → `ALL_SMART_LISTS` to reflect that the rendered subset is conditional.
- Added the Review entry between Anytime and Logbook (matches the spec's ordering and Task 7 router order).
- Added `reviewEnabled` gate that drops the Review item when the feature is off in settings.
- Added `<ReviewBadge />` inline at the end of the button (after the existing `flex-1` label, so the badge sits flush-right naturally).
- The `ReviewBadge` component is co-located at the bottom of the file — single-use, doesn't deserve its own module yet.

- [ ] **Step 2: Typecheck and smoke-check**

Run: `npm run build`
Expected: build succeeds.

Run: `npm run dev`
Open the app. Confirm: (a) "Review" appears in the sidebar between Anytime and Logbook with a violet badge showing the overdue count if any projects are due; (b) clicking it navigates to the Review view; (c) toggling "Enable project review tracking" off in Settings hides the entry entirely. Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/sidebar/SmartListNav.tsx
git commit -m "feat(sidebar): add Review smart-list entry with overdue badge"
```

---

### Task 9: `ReviewSettingsPanel` + mount in SettingsView

**Files:**
- Create: `src/renderer/components/review/ReviewSettingsPanel.tsx`
- Modify: `src/renderer/views/SettingsView.tsx` — mount the new panel inside the **general** tab JSX (NOT the notifications tab; `NotificationSettings` is mounted in the notifications tab at `SettingsView.tsx:172-178`).

Important findings from re-reading `SettingsView.tsx`:
- The general tab body starts at `activeTab === 'general' ? (` (~line 179) and contains a `<div className="mx-6 max-w-lg space-y-6 pb-8 pt-4">` wrapper.
- Each setting block inside is a card with this exact pattern: `<div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">`. Example at line 374 ("Task Parser" card).
- The save handler is named `handleQuickEntryChange` (verified at line 109) — yes, the name is a misnomer; it handles ALL config changes, not just quick-entry. Use it as-is.
- `CompletionSoundSettings` (line 366) is mounted inline within the general tab without a wrapping card from the parent — meaning the component provides its own card. Mirror this approach: `ReviewSettingsPanel` provides its own card wrapper.

- [ ] **Step 1: Create `ReviewSettingsPanel`**

```typescript
// src/renderer/components/review/ReviewSettingsPanel.tsx
import type { AppConfig } from '@/lib/vikunja-types'

interface ReviewSettingsPanelProps {
  config: AppConfig
  onChange: (partial: Partial<AppConfig>) => void
}

const DEFAULT_REVIEW = { enabled: true, default_cadence_days: 14, exclude_inbox: true } as const

export function ReviewSettingsPanel({ config, onChange }: ReviewSettingsPanelProps) {
  const review = config.review ?? DEFAULT_REVIEW

  const update = (patch: Partial<typeof review>) => {
    onChange({ review: { ...review, ...patch } })
  }

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
      <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Review</h2>
      <p className="mb-4 text-xs text-[var(--text-secondary)]">
        Periodic project review, GTD-style. Marker is stored in each project's description so it syncs across clients.
      </p>

      <div className="space-y-3">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={review.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
            className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
          />
          <span className="text-sm text-[var(--text-primary)]">Enable project review tracking</span>
        </label>

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-[var(--text-primary)]">Default review cadence (days)</div>
            <p className="text-xs text-[var(--text-secondary)]">
              How often projects should be reviewed unless overridden per project.
            </p>
          </div>
          <input
            type="number"
            min={1}
            max={365}
            value={review.default_cadence_days}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10)
              update({ default_cadence_days: Number.isFinite(n) ? Math.min(365, Math.max(1, n)) : 14 })
            }}
            disabled={!review.enabled}
            className="w-20 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)] disabled:opacity-50"
          />
        </div>

        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={review.exclude_inbox}
            disabled={!review.enabled}
            onChange={(e) => update({ exclude_inbox: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue disabled:opacity-50"
          />
          <div>
            <div className="text-sm text-[var(--text-primary)]">Exclude Inbox from review list</div>
            <p className="text-xs text-[var(--text-secondary)]">
              Your Inbox is for capture, not for periodic review.
            </p>
          </div>
        </label>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Mount the panel in `SettingsView.tsx`**

Open `src/renderer/views/SettingsView.tsx`. Add the import near the existing `NotificationSettings` / `CompletionSoundSettings` imports (around lines 14-30):

```typescript
import { ReviewSettingsPanel } from '@/components/review/ReviewSettingsPanel'
```

Find the general tab body. After the `CompletionSoundSettings` block (~lines 366-371):

```typescript
{fullConfig && (
  <CompletionSoundSettings
    config={fullConfig}
    onChange={handleQuickEntryChange}
  />
)}
```

Add immediately after it (BEFORE the `{/* Task Parser */}` card at line 374):

```typescript
{fullConfig && (
  <ReviewSettingsPanel
    config={fullConfig}
    onChange={handleQuickEntryChange}
  />
)}
```

The general tab's outer `<div className="mx-6 max-w-lg space-y-6 pb-8 pt-4">` provides the vertical spacing between cards via `space-y-6`.

- [ ] **Step 3: Typecheck and smoke-check**

Run: `npm run build`
Expected: build succeeds.

Run: `npm run dev`
Open Settings → General tab. Confirm the new "Review" card renders with three controls (enable switch, cadence number input, exclude-inbox switch). Toggle the enable switch off → confirm the sidebar Review entry hides (Task 8's `useReviewFeatureEnabled` gate). Change the default cadence to 7, click elsewhere → no errors in console. Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/review/ReviewSettingsPanel.tsx src/renderer/views/SettingsView.tsx
git commit -m "feat(settings): add review settings panel"
```

---

### Task 10: End-to-end manual verification

This task is verification only — no code changes. The PR is ready to merge when these all pass.

**Setup:** a Vikunja instance with at least 3 projects, one of which is the configured Inbox. One project should have a non-trivial description so we can verify the marker doesn't clobber it.

- [ ] **V1: Mark reviewed on a brand-new project**

In Vikunja, create a project with an empty description. Open Vicu, navigate to Review (All tracked tab, since Due will show it as "Never reviewed"), click "Mark reviewed". In Vikunja's web UI, refresh the project. Description should be exactly:

```
---
**Vicu review**: 2026-05-24
```

(with today's date in your local timezone).

- [ ] **V2: Mark reviewed preserves existing description**

Pick a project with a multi-line description. Mark it reviewed. In Vikunja web UI, confirm the original description is untouched and the marker is appended at the end with a `\n\n---\n**Vicu review**: ...` block.

- [ ] **V3: Idempotent marker writes**

Open the network tab in DevTools. Mark a project reviewed. Wait for the optimistic update to settle, then click "Mark reviewed" again. Expected: no second HTTP POST goes out (the marker already matches today's date).

- [ ] **V4: Per-project cadence override**

On a tracked project, open the row menu → Set cadence → enter `7` → Save. In Vikunja web UI, the marker should read `... · every 7 days`. The project should now reappear in the Due tab 7 days after the recorded `lastReviewedAt` (you can fake this by editing the date manually in Vikunja's web UI to a date 8 days in the past).

- [ ] **V5: Exclude / re-include**

Exclude a project via the row menu. Confirm it disappears from the Due list. In Vikunja web UI, marker reads `**Vicu review**: excluded`. In Vicu, switch to All tracked → confirm the excluded project is NOT listed. Open the project directly via `#/project/<id>` → no review controls necessary (controls live in Review view, not on individual project pages — by design). To re-include, edit the project's description in Vikunja web UI and delete the marker block. Refresh Vicu (or wait for query refetch) → project reappears in Due tab.

- [ ] **V6: Archived projects are filtered**

Archive a tracked project in Vikunja. In Vicu Review view, project should disappear from both Due and All tracked. Unarchive → reappears.

- [ ] **V7: Inbox exclusion**

With `exclude_inbox: true` (default), the configured inbox project never appears in Review. Toggle the setting off in Settings → the inbox project appears in Review if it's overdue.

- [ ] **V8: Disable the feature**

Settings → toggle "Enable project review tracking" off. Sidebar "Review" entry disappears immediately (Task 8's `useReviewFeatureEnabled` gate). `useProjectsNeedingReview` returns empty (Task 4's short-circuit in `selectProjects` when `cfg?.review?.enabled` is false). Re-enable → entry restored and any overdue projects reappear in the Due tab.

- [ ] **V9: Standalone mode (if user uses it)**

If standalone mode is enabled, V1-V5 work locally without a Vikunja server. Confirm.

- [ ] **V10: Offline behavior**

Disconnect network. Mark a project reviewed. Optimistic update should reflect immediately. The mutation should queue per existing pending-action mechanism (check `src/main/cache.ts` queue). Reconnect → mutation drains, project state stabilizes.

- [ ] **V11: Malformed marker tolerance**

In Vikunja web UI, edit a project's description to end with `\n---\n**Vicu review**: this is garbage`. In Vicu Review, project should appear as "Never reviewed" (parser warns to console, treats as default). Mark it reviewed → marker gets replaced with the canonical form.

- [ ] **V12: Sidebar badge accuracy**

Count of overdue projects shown in sidebar badge matches the count in the Review view subtitle. After marking one reviewed, badge count decrements.

If any of V1-V12 fail, fix the responsible task's code, re-run typecheck, commit the fix under the appropriate task's commit prefix (e.g. `fix(review): correct marker disambiguation`), and re-run the failing verification step.

---

## Verification summary

Each task's typecheck (`npm run build`) and the V1-V12 matrix above constitute the verification suite. There is no automated test runner to lean on. If `package.json` later acquires a `test` script (e.g. vitest), the highest-value tests would target `src/renderer/lib/review-metadata.ts` — it's pure, has a regex-heavy parser, and has many edge cases per the V11 / spec §8.

A `dist-dry` smoke check is optional but valuable: `npm run dist` produces a Windows installer; run the installer once on a Windows machine to confirm the feature works in a packaged build (sometimes path/CSP/IPC issues only surface there).

## Out of scope (deferred — do not implement)

- Per-project review log (multi-entry history) — only the latest review timestamp lives in the marker.
- Push notifications when a project becomes overdue.
- A "Mark reviewed" button on individual project pages (explicitly rejected during brainstorming).
- Custom-list integration (filtering by review state).
- Test infrastructure (vitest etc.) — out of spec; revisit separately.

## Open follow-ups for the user

- If you have Vicu Android or the MCP service running and pointed at the same Vikunja, after Task 10 verification, do a cross-client check: mark a project reviewed in Vicu Desktop, refresh Android / call the MCP, confirm they see the same `lastReviewedAt` and cadence.
- Decide on icon (`RefreshCw` is the placeholder). If you prefer `ClipboardCheck` or another lucide icon, swap in `SmartListNav.tsx` and `ReviewView.tsx`.
