# Planner

Planner is a view allowing to visualize the progress, duration and ordering of tasks in daily/weekly view.

## Design

Planner deliberately shows completed tasks.

The right side of the Planner carries an editable day-view calendar: 30-minute blocks with a more solid line every hour, on the day picked by clicking a day heading (today by default). Only tasks with a valid `start_date` map to time blocks, using their description duration or a 30-minute default. Due dates are ignored throughout Planner. Completed scheduled tasks remain visible, and overlaps share side-by-side columns. Drag a scheduled block to change its start, its top border
to change start and duration with a fixed end, or its bottom border to change duration with a fixed
start. Task cards from any Planner column can also be dragged onto the calendar: hovering
immediately previews a block at the task's duration, and dropping sets its start to the selected
day and time (snapped to 15 minutes) without changing duration or due date. Its mapping and
editing rules are in `docs/calendar.md`.

The calendar stays flush against the right edge, separate from the padded day cards. Available
Planner width (excluding the sidebar) controls the visible columns: Overdue and Today through
870 px, Tomorrow above 870 px, and the third day above 1420 px. Between these breakpoints,
including 1090–1420 px, the cards stretch instead of adding columns or horizontal scrolling.

The heading's **Previous day** and **Next day** arrows move the displayed range one local day
back or forward, including into the past. **Today** resets the range and calendar to today.
Navigating selects the first displayed day in the calendar; clicking another day heading still
selects that day. Headings stay relative to the actual current date, not the browsed range.
The default range follows local midnight; a browsed range stays pinned until **Today** is used.

## Implementation

`TaskRow` is aware of larger planner feature because it has smaller margins and paddings when displayed in Planner.

## First column: Overdue / Unplanned

The first column has a switch where the other columns show a task count. Left is **Overdue** (open tasks with a start date before the actual current day, excluding dates in the displayed three-day range to avoid duplicates, the default); right is **Unplanned**: all open tasks without a valid `start_date`, even if they have a due date or duration. The column is not a drop target in either mode. Dragging an Unplanned task onto a dated column sets `start_date` to local midnight on that day. Moving a planned task between days preserves its local start time. Neither operation changes `due_date` or duration.

Unplanned tasks are selected client-side (`plannerUnplannedTasks`). Vikunja's filter engine treats the Go zero time (`0001-01-01T00:00:00Z`) as "no date" and never matches it. `plannerTaskFilter` instead fetches every open task plus tasks with a start date in the displayed three-day window (even when narrower layouts hide a day). Browsing changes this bounded window, so completed tasks on past or future days are loaded too. Completed history outside that start-date window is not fetched. No due-date clauses or sorting are used in Planner's query.

## Task duration

Planner tasks may have a duration in whole minutes. Desktop quick add reads a standalone `~XX` token (`~45` is 45 minutes) everywhere it reads other task tokens; the expanded card also has a Duration property. Invalid, fractional and non-positive values are not durations.

Duration is stored in the task description as `<!-- vicu-duration:v1:45 -->`. This keeps the value in the existing Vikunja model, sync and offline queue without exposing it as notes content. Unlike carrier markers, duration is inline metadata and never hides its task from Today, Planner or other task lists.

`start_date`, `due_date` and duration are independent: duration is valid without a start date, and adding or removing a start date does not convert or erase it. `end_date` is ignored completely and is never read or written for duration.

Within Overdue and each day column, Planner groups by the local day of `start_date` and sorts by its timestamp, preserving order for ties. Tasks without a valid start date never appear in a dated column or the calendar. Due dates, `end_date` and duration have no effect on grouping or ordering. A missing duration uses 30 minutes in the calendar without writing duration metadata; moving a block preserves the missing value, while resizing writes the chosen duration. Due-date behavior in all other views is unchanged.
