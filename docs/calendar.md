# Day calendar

The day calendar is the Planner's right-side rail: an editable schedule for the selected local
day, split into 30-minute blocks. It lives in
`src/renderer/components/planner/DayViewCalendar.tsx` and is rendered by `PlannerView` beside the
day columns (see `docs/planner.md`). Events include Vikunja tasks, scheduled routine occurrences,
and selected external CalDAV calendars.

## Task mapping

`src/renderer/lib/planner-calendar.ts` maps the Planner's loaded tasks from active projects. It
uses the same task data as the columns, so optimistic edits and completions update the calendar
without a second request. Completed tasks stay visible, with a check mark and strikethrough.

- **Start date set:** start at `start_date`; the hidden description duration determines the end.
  A midnight start is a real start time.
- **No duration:** use a 30-minute block without writing duration metadata. Invalid duration
  metadata also uses this default. Short blocks retain a minimum visual height of 24 px for
  readability; at the bottom of the day they shift up just enough to remain visible.
- **No valid start date:** no calendar entry, regardless of due date or duration. Open tasks
  remain available in the Unplanned column. There is no **No time** band.
- **`due_date` and `end_date`:** never read or written for calendar scheduling or duration.

Timed intervals are included when they overlap the selected local day and are clipped at its
boundaries; a task ending exactly at midnight does not spill into the following day. Both the
calendar and Planner columns use start dates; an overnight task may also appear in the following
day's calendar. All open tasks are loaded; completed tasks are loaded only when their start date
falls in the three-day Planner window. This does not discover completed intervals whose start
is outside that window (duration is hidden metadata, not server-filterable).

Overlapping blocks share side-by-side columns, assigned independently for each connected overlap
group. Minimum-height markers participate in overlap detection so short tasks cannot cover one
another. Full titles, times and completion state are available as accessible names and native
hover titles. Scheduled blocks can be moved and resized directly; other task properties are still
edited through their existing rows.

## Routine mapping

When routines are enabled, Planner also reads the existing routine-carrier query (no history scan
or archive fetch). Every visible, non-archived routine with an explicit duration contributes a block
for each of its scheduled times on the selected day, even when reminders are off. Weekdays, week intervals, activation dates
and after-completion due dates follow the same rules as the Routines view. An overdue
after-completion routine is shown today at its configured time; future repetitions are not guessed.
Shared routines hidden for this account stay hidden here too.

The routine editor's **Times & reminders** section accepts an optional duration in whole minutes,
applied to every time of that routine. It is stored as the existing
`<!-- vicu-duration:v1:30 -->` comment beside the routine envelope in the carrier description,
not as a new envelope field. Routines without a valid duration do not appear in the calendar,
including existing routines. Clearing duration removes their calendar blocks; task blocks still
use their implicit 30-minute default. Create/edit writes preserve the routine envelope and other description
content. Status, archive and sharing writes preserve the latest server duration.

Routine blocks share overlap columns, day clipping and minimum display height with task blocks,
including spillovers from earlier days. Their title and completion state come from the routine
occurrence, **not** the hidden carrier's title or always-done flag. A heart-pulse icon identifies
routines; completed occurrences have a check and strike, skipped occurrences a skip icon and label.
Blocks are read-only: change times and duration in the routine editor, and log completion in
Routines. They never expose task drag/resize controls or enter task selection. Task move/drop
previews retain routine blocks and recompute their shared overlap layout.

## CalDAV calendars

**Settings → General → Calendars**, immediately after Routines, manages device-local CalDAV
connections. Enter a server/calendar URL and Basic or Digest username/password, a Bearer token,
or no authentication, then choose **Discover and save**. Discovery uses `tsdav`; each discovered
VEVENT calendar has its own visibility checkbox. Editing a connection can rediscover calendars
without entering its saved secret again. Removing a connection does not delete any server data.

Connections and calendar selections live in `userData/caldav.json` (atomic writes, backup, mode
600), separately from Vikunja account configuration and synced preferences. Passwords/tokens are
write-only over trusted IPC and protected with Electron `safeStorage`, with the same explicit
plaintext fallback as other device secrets when OS encryption is unavailable. Use HTTPS; HTTP
is supported for local servers. Requests run in main, time out after 30 seconds and cap decoded
responses at 20 MB. Same-origin redirects are supported; cross-origin discovery/redirects are
refused rather than forwarding credentials to another host. For providers that redirect to a
shard/other host, configure that host's CalDAV URL directly. Interactive OAuth login is not provided.

Planner requests only the selected local day's time range from every enabled calendar. Calendars
refresh every five minutes and on window refocus when stale; the rail's **Refresh** button requests
an immediate refresh. One failing calendar does not hide the others: per-calendar errors appear
above the grid. CalDAV reads/writes do not use the Vikunja offline queue or persisted task cache.

`ical.js` parses each complete resource, including embedded VTIMEZONE definitions, floating and UTC
times, bare IANA TZIDs, RRULE/RDATE/EXDATE, cancelled events and detached recurrence exceptions.
Expansion is bounded at 100,000 iterations per resource. Timed events share overlap columns,
clipping, minimum height and gesture snapping with tasks and routines. Each uses its server's
calendar color (Apple `calendar-color`, alpha normalized to opaque RGB); absent colors receive a
stable URL-derived fallback. A colored border/tint identifies the calendar, with its name in the
accessible name/hover title and time caption, so meaning is not color-only. All-day events appear
in a separate read-only strip. Organizer/attendee properties are preserved; any scheduling or
invitation notifications are managed by the CalDAV server, not sent separately by Vicu.
Advertised read-only calendar privileges and resources without an ETag also disable editing. Existing THISANDFUTURE range
overrides are read-only so a single-occurrence gesture cannot accidentally change later instances.

Timed CalDAV bodies and edges use the same pointer capture, cancellation, auto-scroll and keyboard
controls as tasks. Moving changes DTSTART/DTEND together, preserving elapsed duration; resizing
changes one endpoint. A recurring edit changes **only this occurrence**, creating or updating a
RECURRENCE-ID override, never moving the whole series. The original resource's unrelated events,
notes, alarms, zones and custom properties are preserved. Changed endpoints are written in UTC;
recurrence identity retains the original timezone. DTSTAMP, LAST-MODIFIED and SEQUENCE are updated.

The main process holds opaque event references (object URL, UID, recurrence identity and ETag);
renderer writes contain only that reference and the new start/end. It re-reads the resource and
refuses a stale ETag, then PUTs through `tsdav` with `If-Match`, protecting changes made by another
client between the re-read and write too. Preview is local, saves are optimistic with rollback,
and a successful write refetches CalDAV data. Stable occurrence keys preserve keyboard focus when
a write changes the resource's versioned reference. Network, permission and conflict errors are visible;
failed writes are not queued. CalDAV events never acquire Vikunja task IDs or enter task selection.

Implementation: `src/main/caldav/`, `src/shared/caldav-types.ts`,
`src/renderer/hooks/use-caldav.ts` and `components/settings/CalDavSettings.tsx`.
Tests: `src/main/__tests__/caldav-ics.test.ts`, `caldav-service.test.ts` (real tsdav against a local
HTTP DAV server), and `src/renderer/lib/__tests__/planner-caldav.test.tsx`.

## Scheduling cards from Planner

Drag a task card from a Planner column onto the calendar to schedule it on the selected day.
As soon as the pointer enters the calendar grid, the row-shaped drag overlay is replaced by a
calendar block whose height matches the task's duration (or the implicit 30-minute default).
The preview follows the pointer with its start snapped to the nearest 15-minute line, uses the
same minimum height/day clipping as saved blocks, and shares overlap columns with other events.
The pointer marks the start regardless of where the original card was grabbed. Leaving the
calendar restores the row overlay; Escape discards the preview without writing.

Dropping saves only `start_date` through the existing optimistic/offline mutation path. Duration,
notes, completion, `due_date` and `end_date` stay unchanged. An unplanned task becomes scheduled;
a planned task moves to the selected day and time. For a multi-selection, each task previews its
own duration and receives the same dropped start. Calendar scrolling updates both the preview
and the drop time, even with a stationary pointer. Starts are clamped from midnight through
23:45; a duration extending past midnight is preserved and clipped only for display.

Pointer/drop handling lives in `src/renderer/hooks/use-calendar-drop.ts`, with grid-to-start math
in `src/renderer/lib/planner-calendar-drop.ts`. The calendar is a pointer-only target in the
shared Planner row DnD context; it does not use rectangle intersection with the source card.

## Moving and resizing

Drag a scheduled block's body to move it, or its top/bottom border to resize it. The pointer cursor
and small edge grips (visible on hover or keyboard focus) distinguish the three operations:

- **Body:** change `start_date`, preserving duration exactly (including an absent duration).
- **Top border:** change `start_date` and description duration, keeping the actual end fixed.
- **Bottom border:** change description duration only, keeping the actual start fixed.

Neither `due_date` nor `end_date` is ever changed. Notes and other description metadata are
preserved. A task without duration metadata is moved as a 30-minute block without storing the
default; resizing writes the selected duration using that block's effective start and end.

Displacements snap to 15-minute increments relative to the original time, retaining any original
off-grid minutes/seconds. Resizing cannot invert an interval: the minimum stored duration is one
minute. Resizing uses the effective interval, not its minimum-height display box. A clipped
overnight border has no resize handle because it is not the task's actual endpoint. Completed
blocks support the same gestures.

The preview updates position, duration, time labels and overlap columns locally. Releasing saves
one minimal merge patch through `useUpdateTask`, so optimistic updates, errors/rollback and the
offline queue behave like other task edits. Clicking without dragging, or returning to the original
position before releasing, writes nothing. Escape, pointer cancellation, window blur, leaving
Planner or changing its selected day discards the preview. Other gestures wait while a save is
pending. A refresh during a drag does not overwrite newly received notes with the older description.

The calendar auto-scrolls when an active drag reaches the top/bottom of its viewport. Pointer
capture keeps the gesture working outside the original block, including while overlap columns
change. Each body and edge control is keyboard focusable: Up/Down applies the same edit in
15-minute steps, with instructions linked by `aria-describedby` and a live announcement after
saving. The controls do not participate in Planner row selection or its drag-and-drop machinery.

Editing math lives in `src/renderer/lib/planner-calendar-edit.ts`; pointer/keyboard handling and
preview lifetime are in `src/renderer/hooks/use-calendar-edit.ts`.

## Grid and local time

The day is 48 blocks of 30 minutes (`DAY_SLOT_MINUTES`, `DAY_SLOT_COUNT` in
`src/renderer/lib/day-calendar.ts`), each 36 px tall (`DAY_SLOT_HEIGHT_PX`). Inline block heights,
event positions and opening-scroll math use these same constants.

`dayTimeSlots(dayStart)` is pure and import-free. It returns `minutesFromMidnight`, `isHour`, a
local minute-precision `isoLocal` ("2026-06-10T09:00"), and a clock-only `labelTime` reference.
Labels use a fixed reference date rather than constructing an instant on the displayed day:
otherwise a spring-forward day's nonexistent 02:00 normalizes to 03:00 and duplicates that label.

Event duration is elapsed time; its position uses local wall-clock hours, not elapsed minutes
since midnight. This keeps a 09:00 event on the 09:00 line after a DST change. The fixed 24-hour
grid intentionally shows skipped hours and folds repeated hours onto the same line. An interval
whose end wall time goes backwards during fall-back remains visible as a minimum-height marker.
Edits move endpoints in local clock minutes, then compute resized duration as elapsed minutes.
Moving a block never changes elapsed duration. Within a repeated hour, edits retain the current
occurrence when possible; crossing a nonexistent spring-forward hour must not reverse the gesture's
direction. Tests cover Auckland and New York, including both DST transitions.

## Picking, sizing and scrolling

Click a Planner day heading to pick the calendar's day; today is the default. The header's
**Previous day** and **Next day** arrows shift the displayed range by one local day and select
its first day in the calendar. **Today** restores the current day and the default midnight-following
range. Browsed ranges stay pinned across midnight. If a picked day no longer has a visible
heading after midnight or a resize, the calendar returns to the first day of the displayed range.

The calendar scrolls independently of the Planner columns. Its rail is `sticky` at the top and
right of the view's `ReadingScroll` area (found through `data-scroll-area`), with its full visible
height measured by a `ResizeObserver`. There is no outer padding around the rail and no reserved
scrollbar gutter: it meets the right and bottom edges without creating an extra page scrollbar.
Only the day-card grid has padding; long task columns can still scroll while the rail stays put.
The rail is 320 px wide, capped at 40% of the available width on small windows.

The board responds to the **Planner's available width**, excluding the sidebar:

- **870 px and below:** Overdue / Unplanned, Today, calendar.
- **Above 870 px through 1420 px:** add Tomorrow. At 1090 px and throughout the remaining interval,
  keep these same columns and stretch their widths.
- **Above 1420 px:** add the third day.

The remaining width is shared equally by the day cards; the board never requires horizontal
scrolling. Hidden day columns are unmounted so keyboard selection and dragging only see visible
rows. The fetched three-day window and printed sections do not change with the layout; both follow
the range chosen with the header navigation.

Once the initial task load and rail measurement are ready, the grid scrolls instantly to:

- **today** — the 30-minute block containing an hour before now (`dayOpenSlotIndex`, clamped at
  midnight early in the morning);
- **another day** — the 8 AM hour line.

The target line lands 10 px below the grid viewport's top edge (`OPEN_CLEARANCE_PX`), subject to
the browser's end-of-scroll clamp. Resizing or refreshing task data does not replay this opening
scroll. The grid is keyboard-focusable; its up/down arrows scroll it instead of selecting rows
in the Planner. No smooth scrolling or new animation, so reduced motion needs no variant.

## Styling, semantics and verification

The calendar is an edge-to-edge rail, not a day card: `border-l border-border bg-bg-card`, no
rounded corners or outer margins, and a 48 px header matching the columns.
Hour labels use `text-meta text-text-secondary`; the title uses `text-section`; task blocks use
`bg-bg-selected` with a visible border. Completion has a shape and strike, not just a colour.
There are no new font sizes, radii or durations outside the design tokens.

The hour grid is an `<ol>` with decorative half-hour blocks and `<time dateTime>` labels. Separate
labelled lists contain the hours and scheduled tasks; the section is labelled by its heading. Calendar entries deliberately do not carry `data-task-id`, which belongs exclusively to
the real task rows and their selection/drag/editor machinery.

Unit tests live in `src/renderer/lib/__tests__/day-calendar.test.ts`, `planner-calendar.test.ts`,
`planner-calendar-edit.test.ts` and `planner.test.ts`. `scripts/ui-verify/scenarios/planner-calendar.mjs` checks actual scroll
position, event geometry, day selection, overlap columns, bounded fetching and narrow-window
layout. `planner-duration.mjs` also checks live calendar updates after editing a duration.
`planner-calendar-edit.mjs` checks body/edge gestures, preview-before-write, cancellation, keyboard
editing, completed and default-duration events, preserved dates/notes, and edge auto-scrolling.
`planner-calendar-drop.test.ts` covers card-drop snapping, duration geometry, selection and local
time; `planner-calendar-drop.mjs` exercises immediate card previews, leaving/cancelling, saving on
the selected day, implicit duration and live scrolling with real pointer input.
