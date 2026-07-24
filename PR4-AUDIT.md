# PR #4 Audit: "Add assignee and shared project support"

## Context

PR #4 from `tyleisher:main` adds assignee support to Vicu — the ability to see, assign/remove users on tasks, and filter by "assigned to me". Despite the title mentioning "shared project support", the PR only implements assignee functionality. This audit evaluates correctness, completeness, and adherence to existing codebase patterns.

---

## What the PR Does Well

1. **Full IPC stack coverage**: Properly implements the complete path: `api-client.ts` → `ipc-handlers.ts` → `preload/index.ts` → `api.ts` → components
2. **TaskFilterContext**: Smart approach to propagate the filter state to `SectionGroup` children without prop drilling
3. **AssigneePickerPopover**: Follows the established popover pattern (click-outside close, debounced search, merge current + search results)
4. **Keyboard navigation**: Correctly updates all `tasks` references to `visibleTasks` in `TaskList.tsx`
5. **Empty state**: Contextual empty state when filter is active vs normal empty
6. **`fetchUser` consolidation**: Replacing `fetchCurrentUser` (which used raw `net.fetch`) with `fetchUser` using `requestWithRetry` is an improvement — gains automatic token refresh on 401

---

## Issues Found

### Critical Issues

#### 1. `fetchUser` returns raw API response — breaks SettingsView contract
- **Old**: `fetchCurrentUser` in `auth/user-info.ts` carefully mapped the response: `name: data.name ?? data.username`, `email: data.email ?? ''`
- **New**: `fetchUser()` returns `ApiResult<unknown>` — passes through the raw Vikunja `user.User` object
- **Impact**: `SettingsView.tsx:51` calls `api.getUser()` expecting `VikunjaUser | null`. The raw API response has extra fields (`created`, `updated`, `settings`, etc.) which won't break, but: if `name` is empty/null, the old code fell back to `username` — the new code won't
- **Fix needed**: Either shape the response in `fetchUser` or in the IPC handler

#### 2. `user-info.ts` becomes dead code
- The PR removes the `fetchCurrentUser` import from `ipc-handlers.ts` but **does not delete** `src/main/auth/user-info.ts`
- The `VikunjaUser` interface exported from `user-info.ts` is no longer imported by anything in main process
- Should delete the file or keep it if other code references it (grep shows nothing does)

#### 3. Missing `notifyViewerSync()` / `notifyMainWindow()` on assignee mutations
- Every task-mutating IPC handler in the codebase calls `notifyViewerSync()` and/or `notifyMainWindow()` on success (create-task, update-task, delete-task, quick-entry handlers)
- The new `add-assignee-to-task` and `remove-assignee-from-task` handlers **do not** call either
- **Impact**: Quick View window and main window won't get notified of assignee changes, causing stale data in multi-window scenarios

### Moderate Issues

#### 4. `VikunjaUser` type is now defined in 3 places
- `src/main/auth/user-info.ts` (dead but still exists)
- `src/renderer/lib/api.ts` (used by SettingsView)
- `src/renderer/lib/vikunja-types.ts` (new, used by Task interface and components)
- Should consolidate: define once in `vikunja-types.ts`, import in `api.ts`

#### 5. `useCurrentUser` hook throws on null — poor error handling
- The hook does `if (!user) throw new Error('User not available')` which will cause TanStack Query to treat it as an error state
- But `api.getUser()` can legitimately return `null` when using API token auth (the SettingsView only fetches user for OIDC/password auth)
- In `TaskList.tsx`, `useCurrentUser()` is called unconditionally regardless of auth method
- **Impact**: For API token users, this will perpetually show error state or retry, wasting network calls. The `retry: false` mitigates infinite retries, but the hook still errors initially

#### 6. `searchUsers` uses Vikunja `/api/v2/users` endpoint — may not return all users
- Per the API spec, `/users` search: "Name (not username) or email require that the user has enabled this in their settings"
- Users who haven't enabled discoverability won't appear in search results
- This is a Vikunja limitation, not a bug per se, but worth documenting

#### 7. No optimistic updates on assignee mutations
- `useAddAssignee` and `useRemoveAssignee` only invalidate queries on settled — no optimistic UI update
- This means there's a visible delay between clicking an assignee and seeing the change
- Existing pattern: simple mutations like `useAddLabel` also don't use optimistic updates, so this is **consistent** but suboptimal for UX
- The `currentAssignees` in the popover comes from the task prop, so the checkmark won't update instantly

#### 8. Missing `task-detail` query invalidation
- Label mutations invalidate `['tasks']`, `['view-tasks']`, `['task-detail']`, `['section-tasks']`
- Assignee mutations invalidate `['tasks']`, `['view-tasks']`, `['section-tasks']` but **miss `['task-detail']`**
- If a task detail view is ever added, assignee changes won't refresh it

### Minor Issues

#### 9. Assignee avatars placement in collapsed row
- Assignee avatars are rendered **before** the task title (between labels and title)
- This adds visual noise to every row that has assignees
- Design choice, but may clutter the compact row — consider showing only on hover or in expanded view

#### 10. Filter button always visible — even in standalone/offline mode
- The `UserCheck` filter button shows in the header regardless of whether the app is connected to a Vikunja server
- In standalone mode, there are no assignees, so the button is meaningless
- Should conditionally render based on connection status or auth state

#### 11. PR title says "shared project support" but no shared project features
- The PR title is "add assignee and shared project support" but there is no shared project functionality implemented
- The PR only adds assignee display, assign/remove, and filter

#### 12. `searchUsers` API function returns `Promise<ApiResult<unknown[]>>`
- Should be typed as `Promise<ApiResult<VikunjaUser[]>>` or a proper user type instead of `unknown[]`
- The renderer `api.ts` correctly casts it, but the main process loses type info

---

## Summary

| Severity | Count | Key Items |
|----------|-------|-----------|
| Critical | 3 | `fetchUser` response shape change, dead code, missing window notifications |
| Moderate | 5 | Type duplication, useCurrentUser error handling, missing query invalidation |
| Minor | 4 | UI placement, filter visibility, misleading PR title, loose typing |

## Recommended Actions

1. **Fix `fetchUser`** to shape the response like the old `fetchCurrentUser` (or handle in IPC handler)
2. **Add `notifyViewerSync()`** calls to assignee IPC handlers
3. **Delete `src/main/auth/user-info.ts`** (dead code)
4. **Fix `useCurrentUser`** to return `null` instead of throwing when user is unavailable
5. **Add `['task-detail']`** to assignee mutation invalidation
6. **Consolidate `VikunjaUser`** to single definition in `vikunja-types.ts`
7. **Conditionally show** the filter button based on auth/connection state
