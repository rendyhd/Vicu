# Cross-app semantics v1

This contract defines how Vicu desktop and Vicu Android interpret synced data, so the same
server state means the same thing on every device. The file is kept identical in both repos
(`docs/cross-app-semantics-v1.md`), next to `description-format-v1.md`.

Test vectors live in `test-fixtures/` in both repos and must stay byte-identical:

| Fixture | Covers |
|---|---|
| `cross-app-semantics-v1.json` | due-date rules, smart lists, weeks, custom-list windows, review math |
| `nlp-corpus-v1.json` | quick-add parsing |
| `routine-archive-v1.json` | routine merge, pruning and archive rules |

Both test suites load these files. When behavior changes, change the fixture first, in both
repos, in the same release.

All times in this document are **local wall-clock times in the device's time zone** unless
they say UTC. Fixtures write them as `YYYY-MM-DDTHH:mm:ss` without an offset; tests convert
them with the system time zone. Fixtures avoid DST transition hours.

---

## 1. Due dates

### 1.1 Date-only values

- A due date without a time of day ("date-only") is stored as **local 23:59:59** of that date
  (milliseconds 0), converted to UTC for the API.
- A due date with an explicit time ("3pm", "14:30", a time picker) is stored as typed.
- No due date is Vikunja's null date `0001-01-01T00:00:00Z`. To clear a due date, send
  `"due_date": null` in a merge patch (the server stores the null date).

### 1.2 Display

- A due date whose local time is 23:59:59 is date-only: show the date, no time.
- Legacy values at local 00:00:00 are also shown as date-only (older versions stored
  date-only values at midnight). Don't rewrite them in bulk; they become 23:59:59 the next
  time the user sets the date.
- Any other local time is explicit: show the time (device 12/24-hour setting).
- Show the year when the date is not in the current year.

### 1.3 Setters

Every place that sets a date-only due date uses one helper per app (desktop
`dateOnlyDue(localDate)`, Android `DueDates`). Reference: Tue 2026-10-06 10:00.

| Action | Result |
|---|---|
| Today | 2026-10-06 23:59:59 |
| Tomorrow | 2026-10-07 23:59:59 |
| Next week | Monday of next week, 2026-10-12 23:59:59 (on a Sunday: the next day) |
| Pick a date (calendar) | that local date at 23:59:59, built from the local calendar date, never from UTC millis |
| "!" shortcut | today, 23:59:59 |
| Postpone / move by N days | adds N calendar days and keeps the time of day; a legacy 00:00 value becomes 23:59:59 |

Reminders relative to the due date ("1 hour before") are computed from the stored value, so
"1 hour before" a date-only task fires at 22:59:59 that day.

---

## 2. Days, weeks and smart lists

- "Today" is the device's local calendar date. A task is due today when the local date of its
  due date equals today, whatever the time of day.
- Weeks start on **Monday** and end on **Sunday**.
- **Today list**: open tasks with a due date whose local date is today or earlier.
  - Overdue section: local date before today.
  - Today section: local date equal to today. A task due at 08:00 today is still in the Today
    section at 10:00; it moves to Overdue tomorrow.
- **Upcoming list**: open tasks whose local due date is tomorrow or later.
- Server filters must use local-day boundaries converted to UTC, for example "before the start
  of tomorrow" is `due_date < '<local tomorrow 00:00 as UTC ISO>'`. A server filter may return
  more than the window (the client filters exactly), never less.

---

## 3. Custom lists

Custom lists sync through the `vicu-custom-lists:v1` carrier. The list `filter` object gains
one field:

| Field | Type | Meaning |
|---|---|---|
| `include_overdue` | boolean, optional | Whether date windows also include overdue tasks. Absent means `true`. |

Both apps' protocol normalizers must **preserve unknown fields** in list values and filters
from now on, so a future field added by one app survives a round trip through the other.

### 3.1 Date windows (`due_date_filter`)

With today = T (local date):

| Value | Tasks included (open tasks, or all when `include_done`) |
|---|---|
| `all` | no date condition |
| `overdue` | local due date < T |
| `today` | local due date = T |
| `this_week` | T ≤ local due date ≤ Sunday of T's week (on a Sunday: T only) |
| `this_month` | T ≤ local due date ≤ last day of T's month |
| `has_due_date` | any due date |
| `no_due_date` | null date (or empty) |

For `today`, `this_week` and `this_month`: when `include_overdue` is true (or absent), tasks
with a local due date before T are included too. `overdue`, `has_due_date`, `no_due_date` and
`all` ignore the flag.

### 3.2 Other conditions

- `include_done: false` keeps open tasks only.
- `project_ids` with `project_filter_mode` `include` (default) keeps tasks in those projects;
  `exclude` removes them.
- `include_today_all_projects` (only with a non-empty `project_ids`): a task passes the project
  condition if it passes the include/exclude rule above **or** it falls in the `today` window
  (which honors `include_overdue`). This works the same in include and exclude mode. The date
  window still applies to every task.
- `priority_filter` keeps tasks whose priority is in the list.
- `label_ids` keeps tasks with at least one of the labels.
- Evaluate all conditions on the full task set **before** hiding nested subtasks. A subtask
  that matches is shown even when its parent doesn't. The same applies to Tag views.

### 3.3 Edge references

| Today | `this_week` ends | `this_month` ends |
|---|---|---|
| Tue 2026-10-06 | Sun 2026-10-11 | 2026-10-31 |
| Sun 2026-10-11 | Sun 2026-10-11 | 2026-10-31 |
| Mon 2026-10-12 | Sun 2026-10-18 | 2026-10-31 |
| Sat 2026-10-31 | Sun 2026-11-01 | 2026-10-31 |

---

## 4. Project review

The review footer format is unchanged. Status math uses **local calendar dates** only:

- `today` = the device's local date.
- `last` = `lastReviewedAt` (a local `YYYY-MM-DD`).
- `cadence` = `cadenceDaysOverride` or the global default (14).
- `next = last + cadence days`, `daysSince = today - last`, `daysUntil = next - today`.
- Overdue when `daysUntil < 0`; "due today" when `daysUntil = 0`.
- `never` (or no `lastReviewedAt`): overdue, no dates. `excluded`: never overdue, no dates.

---

## 5. Quick-add parsing (NLP)

Both apps must produce the results in `nlp-corpus-v1.json`. The syntax (labels, projects,
priority, modes, the disabled parser) is defined in `shared-parser-spec.md`; this section adds
the date and recurrence rules.

### 5.1 Dates

- Date-only phrases produce local 23:59:59 (section 1.1). Phrases with a time keep the time.
- Supported date phrases: `today`, `tomorrow`, weekday names, `this <weekday>`,
  `next <weekday>`, `next week`, `next month`, `in N days|weeks`, `in N hours|minutes`
  (exact time), month-name dates (`jan 15`, `15 jan`, `march 3rd`), ISO dates
  (`2026-10-15`) and slash dates (`10/15`, `15/10`).
- Times: `3pm`, `3:30pm`, `14:00`, optionally after `at`, before or after a date phrase. A time
  without a date means today if that time is still ahead, otherwise tomorrow.
- Weekdays:
  - A bare weekday or `this <weekday>` is the next occurrence on or after today (today
    included).
  - `next <weekday>` is that weekday in the following Monday-start week. On Tue 2026-10-06,
    `next friday` is 2026-10-16; on Sun 2026-10-04, `next monday` is 2026-10-05.
  - `next week` is the Monday of the following week.
- Three-letter weekday abbreviations (`mon`, `tue`, `tues`, `wed`, `thu`, `thur`, `thurs`,
  `fri`, `sat`, `sun`) only count as dates when preceded by `on`, `next`, `this`, `by` or
  `due`, or followed by a time. Full weekday names always count. "Buy sun cream" has no date.
- Dates without a year that already passed this year roll to next year (`jan 15` in October
  is next January). A date equal to today stays today.
- Slash dates follow the device locale's day/month order (`en-US`: month/day; most other
  locales: day/month). When the first number can't be a month (`15/10` in `en-US`) the order
  flips. ISO dates are unambiguous.
- The connector words `on`, `by` and `due` directly before a date phrase, and `at` directly
  before a time, are removed together with the date.
- `now` is never a date.
- The `!` today shortcut has one rule in every entry point: a standalone `!`, a leading `!`
  (not followed by a priority token such as `!1` or `!high`) or a trailing `!` means today
  (date-only). A `!` inside the text ("Hello! world") is not a date. It works even when the
  parser is disabled.

### 5.2 Recurrence

- `every N day|days|week|weeks|month|months|year|years`, `every day|week|month|year`.
- Shorthand `daily`, `weekly`, `monthly`, `yearly`, `annually`, `biweekly`, `fortnightly`
  (biweekly and fortnightly = every 2 weeks). Shorthand counts when it is the whole remaining
  input or its last word ("Water plants daily"), not when other words follow it ("weekly
  standup", "daily review tomorrow").
- `every <weekday>` (full name) means weekly, with the due date on the next occurrence of that
  weekday (today included) unless the input has another date. A time after it applies ("every
  monday 10am").
- The API mapping is unchanged (monthly is `repeat_mode` 1; `every N months` for N > 1 and
  yearly use day approximations, as today).

---

## 6. Routine history

Routine carriers keep using `<!-- vicu-routine:v1:<base64url JSON> -->`. This section adds the
archive and changes the merge.

### 6.1 Limits

- The decoded JSON of a main carrier or an archive part must stay at or below **384 KiB**
  (393,216 bytes). The hard reject limit stays 512 KiB, so older clients can still read it.

### 6.2 Rolling window and pruning

- The main carrier keeps occurrences whose `scheduledDate` is within the last **400 days**
  (cutoff = today - 400 days). If the payload would still exceed 384 KiB, the cutoff moves
  forward in steps of 30 days until it fits.
- Pruning happens on write. The effective cutoff is the later of the computed cutoff and the
  existing `prunedBefore` (it never moves backwards). Occurrences with `scheduledDate` before
  the effective cutoff move to the archive first; only after the archive write succeeds does the
  main carrier drop them and set `prunedBefore` to the effective cutoff (a local `YYYY-MM-DD`).
  An empty `prunedBefore` means nothing was pruned yet.

### 6.3 Merge

- `prunedBefore` = the later of the two values.
- Occurrences: union of keys; for a key in both, last-write-wins by `modifiedAt` (compare
  parsed instants, not strings), ties broken by the larger `modifiedBy`.
- Then **drop** every occurrence whose `scheduledDate` is before `prunedBefore`; those live in
  the archive. This stops pruned history from flapping back in.
- Definition: last-write-wins by `definition.updatedAt` (parsed), ties by `updatedBy`.
- Timestamps are written as UTC ISO-8601 with exactly three fraction digits
  (`2026-10-06T08:00:00.000Z`).

### 6.4 Archive parts

- An archive part is a **done** task in the same project as the routine's main carrier, with
  title `Vicu routine archive` and a description holding only the marker
  `<!-- vicu-routine:archive:v1:<base64url JSON> -->`.
- JSON: `{ "version": 1, "routineId": "<id>", "part": <int, 1-based>, "occurrences": { "<key>": <occurrence record> } }`.
- Reading the history of a routine = the main carrier's occurrences plus the union of all
  archive parts with that `routineId` (any part number, duplicates allowed), merged per key
  with the same last-write-wins rule. The main carrier wins over the archive for the same key
  only when it is newer by the same rule.
- Writing: append moved occurrences to the part with the highest `part` number if the result
  stays within 384 KiB; otherwise create a new part with `part + 1`. A change to an archived
  occurrence is written to the part that holds its key.
- Archive parts are metadata: hidden from every task list, search, badge and count, like
  routine carriers (both apps already hide any description containing `vicu-routine:`).
- Archive parts are never deleted automatically. Deleting a routine deletes its parts.
- Older app versions treat archive parts as malformed routine carriers (hidden from lists).

### 6.5 Schedules

- `after_completion`: the next due date is the latest **completion date** plus
  `intervalDays` (it used to count from the scheduled date).
  - The completion date of a `COMPLETED` occurrence is the local date of its `loggedAt` in the
    occurrence's `timeZoneId` (the device zone if that is missing or unknown). Without a
    `loggedAt` it is the occurrence's `scheduledDate`.
  - "Latest" is the largest completion date over all `COMPLETED` occurrences (main carrier
    only; the latest completion is never old enough to be archived).
  - Before the first completion the due date is `firstDueDate`.

### 6.6 Migration

Android 1.8.x kept pruned history in a phone-only table. On first launch of 1.9.0, Android
uploads that table into archive parts (merged with any existing parts), then treats the table
as a cache.
