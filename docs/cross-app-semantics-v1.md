# Cross-app semantics v1

This contract defines how Vicu desktop and Vicu Android interpret synced data, so the same
server state means the same thing on every device. The file is kept identical in both repos
(`docs/cross-app-semantics-v1.md`), next to `description-format-v1.md`.

Test vectors live in `test-fixtures/` in both repos and must stay byte-identical:

| Fixture | Covers |
|---|---|
| `cross-app-semantics-v1.json` | due-date rules, smart lists, weeks, custom-list windows, review math, completion hold, date display, collaboration, hidden tasks, synced preferences, task order, project categories, guided organizing |
| `nlp-corpus-v1.json` | quick-add parsing |
| `routine-archive-v1.json` | routine merge, pruning and archive rules |
| `design-tokens-v1.json` | colour roles, type, radii and motion (see `design-system-v1.md`) |

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
- Show the year when the date is not in the current year. How dates are phrased in each
  place (rows, chips, headers, the logbook) is section 8.

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
these fields:

| Field | Type | Meaning |
|---|---|---|
| `include_overdue` | boolean, optional | Whether date windows also include overdue tasks. Absent means `true`. |
| `assigned` | string, optional | `me`, `others` or `nobody` (section 3.3). Absent means no condition. |
| `comments` | string, optional | `unread` or `any` (section 3.3). Absent means no condition. |
| `shared_only` | boolean, optional | Only tasks of shared projects (section 3.3). Absent means `false`. |
| `changed_within_days` | whole number, optional | Only tasks changed on the last N local days, today included (section 3.3). Absent means no condition. |

Apps write `assigned`, `comments`, `shared_only` and `changed_within_days` only when they are
set. A string value of `assigned` or `comments` that this version does not know is kept as it
is and is no condition, like a `due_date_filter` from a newer app.

Both apps' protocol normalizers must **preserve unknown fields** in list values and filters
from now on, so a future field added by one app survives a round trip through the other.

A list's `icon` is a key of the shared icon set (`folder`, `star`, ... `palette`; empty or a key
an app does not know is drawn as the filter icon), or `none`: the list is drawn without an icon,
and its name starts where the icon would be (a name may begin with an emoji instead). Places that
need an icon whatever the list says (a bottom-bar slot, which has its own) are not affected.

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

### 3.3 Collaboration and activity

These conditions gather the tasks people share (section 9) and the tasks that moved. Next to
today, the evaluator takes who you are and which projects are shared.

- A project is **shared** as in section 9.1: its members include someone besides you; one whose
  members are not known yet is not shared. `assigned` and `comments` only match tasks of shared
  projects, the tasks whose rows show assignees and comments; a task of a project nobody else can
  see never matches them, whatever the server holds for it.
- `shared_only: true` keeps tasks of shared projects.
- `assigned`: `me` keeps tasks you are assigned to (alone or with others); `others` keeps tasks
  with at least one assignee where you are not one of them; `nobody` keeps tasks without
  assignees. While you are not known (signed out), `me` and `others` match nothing.
- `comments`: `unread` keeps tasks whose `is_unread` is true (a comment or a mention you have not
  read, section 9.4); `any` keeps tasks with a `comment_count` above 0. A task you read in an
  `unread` list keeps its place there until you leave the list, so opening the thread does not
  pull the row away; the next visit no longer shows it.
- `changed_within_days: N` (a whole number, 1 or more) keeps tasks whose `updated` is at or
  after the start of the local day N - 1 days before today: 1 is changed today, 7 the last seven
  days (a time after now, from a server clock ahead of this device, counts too). The server moves `updated` when a task is edited, completed or reopened, commented on,
  assigned or unassigned, or labelled; marking its comments read does not (checked on 2.4.0). It
  counts your own changes too: the API does not say who changed a task. Any other value (0, a
  negative or a fraction, not a number) is no condition. The server clause
  `updated >= '<start of that local day>'` is exact.
- `include_today_all_projects` only widens the project condition; these conditions still apply
  to every task.
- Apps ask the server for `comment_count` and `is_unread` only while a project is shared
  (section 9.4), so these conditions cost nothing for a user who shares nothing.

Vectors: the `customListActivity` block of the fixture (`me`, the shared project ids, its own
tasks with `assignees`, `commentCount`, `unread` and `updated` as local wall-clock times; a
vector with `signedOut: true` runs without `me`).

### 3.4 Edge references

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
  `next <weekday>`, `<weekday> this week`, `<weekday> next week`, `next week`, `next month`,
  `in N days|weeks`, `in N hours|minutes` (exact time), month-name dates (`jan 15`, `15 jan`,
  `march 3rd`), ISO dates (`2026-10-15`) and slash dates (`10/15`, `15/10`). `weekend` and
  `weekday` are words, not dates: "Plan the weekend" has no due date.
- A date phrase is made of whole words: it starts at the start of the text or after a space,
  and ends at a space, the end of the text, or one of `. , ! ? ; )`. "Send Monday's report
  tomorrow" is due tomorrow, and "Call Ana (tomorrow)", "Plan Friday/Saturday" and "Ship it
  tomorrow-ish" have no due date.
- Phrases about the past are not dates and stay in the title: `yesterday`, `last night`,
  `last <weekday>`, `past <weekday>`, `<weekday> last week`, `last week|month|year` and
  `N days|weeks|... ago`. "Review notes from last friday" has no due date.
- Times: `3pm`, `3:30pm`, `14:00`, optionally after `at`, before or after a date phrase. A time
  without a date means today if that time is still ahead, otherwise tomorrow.
- Weekdays:
  - A bare weekday or `this <weekday>` is the next occurrence on or after today (today
    included). `<weekday> this week` is the same as `this <weekday>`.
  - `next <weekday>` is that weekday in the following Monday-start week. On Tue 2026-10-06,
    `next friday` is 2026-10-16; on Sun 2026-10-04, `next monday` is 2026-10-05.
    `<weekday> next week` is the same as `next <weekday>`.
  - `next week` is the Monday of the following week.
  - A weekday directly followed by another date (only spaces or a comma between them) is part
    of the title, and the other date is the due date: "Call Ana about Saturday tomorrow at 3pm"
    is due tomorrow at 15:00 with the title "Call Ana about Saturday", and "Party Saturday
    oct 17" is due on 2026-10-17 with the title "Party Saturday". A time is not another date
    ("Call wed 3pm" is Wednesday at 15:00); `in N hours|minutes` is.
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
- When a text has more than one date phrase (apart from the weekday rule above), the first is
  the due date and the others stay in the title: "Book Friday dinner tomorrow" is due on
  Friday with the title "Book dinner tomorrow".
- A label, project or priority is never part of a date phrase. One inside a phrase splits it
  in two, and the first part is the due date: "Call tomorrow @home 3pm" is due tomorrow
  (date-only) with the title "Call 3pm". A connector word does not reach across one either:
  "Pay rent by @money friday" is due on Friday with the title "Pay rent by".
- There are no date ranges. `to`, `until`, `through`, `till` or a dash between two dates or
  times leaves two phrases, and the first is the due date: "Trip friday to sunday" is due on
  Friday with the title "Trip to sunday", and "Meeting tomorrow 3pm to 5pm" is due tomorrow
  at 15:00 with the title "Meeting to 5pm". A range written as one word ("3-5pm") is not a
  date phrase.
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

### 5.3 Places

A phrase that names a saved place (section 11.7) asks for a location reminder: "Call mom when I
get home" is the title "Call mom" with a reminder on arriving at Home. The parser reads it only
when the app gives it the saved places (their ids and names); without places, or with the parser
off, the words stay in the title. The corpus parses every case with its `places`.

- The phrase is a lead-in and a place name. Arriving: `when I get`, `when I get to`, `when I get
  back`, `when I get back to`, `when I arrive`, `when I arrive at`, `when I arrive in`, `when I
  arrive back at`, `when I'm`, `when I am`, `when I'm at`, `when I am at`, `when I'm back`, `when
  I am back`, `when I'm back at`, `when I am back at`, `when I come`, `when I come to`, `when I
  come back`, `when I come back to`, `when I reach`, `once I get`, `once I get to`, `once I'm`,
  `once I'm at`, `arriving at`. Leaving: `when I leave`, `when I'm leaving`, `when I am leaving`,
  `when I get out of`, `once I leave`, `leaving`. `the ` or `my ` may stand before the name.
- Matching ignores case, and a curly apostrophe (’ or ‘) counts as a straight one, in the
  phrase and in the place name ("when I’m at Mom’s").
- The phrase is made of whole words: no letter, digit or apostrophe directly before it or after
  it. "when I get homework done" names no place.
- A phrase that starts with `when` or `once` counts anywhere in the text. `leaving` and
  `arriving at` count only at the start of the text or at its end (where only spaces and
  `. ! ?` follow): "Take the keys leaving home" is a reminder, "Stop leaving work late" is not.
- When several phrases match, the longest wins, and between equally long ones the earliest.
  Only one place is read. Two saved places with the same name (ignoring case): the one whose id
  comes first in character-code order.
- The phrase leaves the title together with what joined it to the rest: at the start, the
  spaces and `, ; : -` after it ("When I get home, call mom" is "call mom"); at the end, the
  spaces and `, ; : -` before it and the `. ! ?` after it ("Call mom, when I get home." is "Call
  mom"); in the middle, a `,` or `;` right after it (spaces between allowed): "Buy milk, when I
  get home, and bread" is "Buy milk, and bread".
- A phrase that would leave no title is not read: "When I get home" stays the title.
- The place is read before labels, projects, priority, recurrence and dates, so no word of the
  phrase is read as anything else; the rest of the text is parsed as usual ("Buy milk when I
  leave work tomorrow #errands").
- The reminder uses the default radius (200 m). It is written as `location_reminder.<taskId>`
  once the task has its server id (section 11.7).

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
- The effective cutoff never passes today. For an `after_completion` routine it also never
  passes the `scheduledDate` of the latest completion (section 6.5), or `firstDueDate` before
  any completion, so the record the schedule counts from always stays in the main carrier
  (a chore left undone for more than 400 days would otherwise never advance).
- `prunedBefore` only moves when at least one occurrence was archived.

### 6.3 Merge

- `prunedBefore` = the later of the two values.
- Occurrences: union of keys; for a key in both, last-write-wins by `modifiedAt` (compare
  parsed instants, not strings), ties broken by the larger `modifiedBy`.
- Then **drop** every occurrence whose `scheduledDate` is before `prunedBefore`; those live in
  the archive. This stops pruned history from flapping back in.
- Definition: last-write-wins by `definition.updatedAt` (parsed), ties by `updatedBy`.
- Timestamps are written as UTC ISO-8601 with exactly three fraction digits
  (`2026-10-06T08:00:00.000Z`).
- A **placeholder** is a `NOT_LOGGED` record an app writes on its own for a missed day (section
  6.7), not because a person logged it. Its `modifiedAt` is `1970-01-01T00:00:00.000Z`, so any
  record a person wrote wins the merge, also one a device saw only after it wrote the placeholder.

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

### 6.7 Routine definition fields

Routines have one type for the user: a name, one to five times and a schedule. There is no
health or chore choice, no subtype, no amount or unit and no named periods. Older app versions
still read these fields (mobile up to 2.2 fails to decode a routine without `kind` or a slot
without `label` and `period`; desktop up to 2.2 trims `amount` and `unit`), so every write keeps
them with these values:

- `kind`: `"CHORE"` when the schedule is `after_completion`. Otherwise `"HEALTH"` for a new
  routine; an edit keeps the stored kind unless the schedule changes to `after_completion`.
- `healthSubtype`: `null`. `amount` and `unit`: `""`.
- Each slot keeps its `id`, its `followUpMinutes` and any unknown fields across edits (history
  is keyed by slot id).
- A slot's `label` is its time as `HH:MM` (24-hour, two-digit hours).
- A slot's `period` follows its time and is unique within the routine: before 12:00
  `"MORNING"`, before 17:00 `"AFTERNOON"`, otherwise `"EVENING"`; when that period is taken by an
  earlier slot (slots in time order), the first free one of `"MORNING"`, `"AFTERNOON"`,
  `"EVENING"`, `"ANYTIME"`, `"HOME"`. Older editors key slots by period, so a routine has at
  most five slots.

Neither app shows `kind`, `healthSubtype`, `amount`, `unit`, `label` or `period`, and none of
them changes what is shown. (The mobile app still writes explicit `NOT_LOGGED` records for the
missed days of a `HEALTH` calendar routine, which older versions expect; it changes nothing on
screen. Those records are placeholders, section 6.3.) Status of an occurrence on a past date:

- `calendar` schedule: an occurrence without a record (or still `PENDING`) on a date before
  today is shown as **Not logged**.
- `after_completion` schedule: the due occurrence stays due (`PENDING`) until it is completed
  or skipped, and is shown on today when its due date has passed (section 6.5). It is never
  marked Not logged.
- Routines have no overdue state.

### 6.8 Writing a carrier

- A write reads the server's copy of the main carrier, merges the change into it (6.3) and sends
  the result as a JSON Patch: `PATCH tasks/{id}` with `Content-Type: application/json-patch+json`.
  The first operation is `{"op": "test", "path": "/description", "value": <the description it
  read>}`, followed by `replace` operations for `title`, `description` and the fields of section
  10.2 (`done`, `due_date`, `repeat_after`, `repeat_mode`, `reminders`). When the test fails,
  Vikunja applies none of it and answers 422: the carrier changed since it was read, so the app
  reads it again, merges and sends again. A 304 means the server already holds the result.
  (`If-Match` cannot do this: Vikunja 2.4 ignores it on `PATCH`. A JSON Patch body may exceed the
  1 MiB that a merge patch is limited to, which the test operation needs for the largest
  carriers.)
- **Read back.** Vikunja 2.4 checks the test and stores the result in two steps, so two writes
  that arrive at the same moment can both pass the test, and the one stored last removes what the
  other wrote; on an SQLite server one of them fails with a 500 ("database is locked") instead. So
  a write that went through waits half a second, reads the carrier again and merges what it sent
  into it: when that changes the server's copy, something it sent was lost, and it sends the merge
  (a further write, tested as above). A 5xx answer is treated like a 422, after a short wait. At
  most four writes in all, then the app reports the write as failed.
- **Lost changes.** When a refresh brings a carrier the app has a copy of (the one it last wrote
  or read), and the server's copy lacks records of that copy that this device wrote (`modifiedBy`
  is its device id, `modifiedAt` within the last 7 days) or holds older ones, or lacks a definition
  change this device made in that time, the app writes those again (a carrier write as above, its
  local side only those records and that definition). Records of other devices and older ones are
  left to the server, so an old copy never brings back what another device archived.
- An archive part (6.4) that already exists is written the same way, with `description` only, and
  read back the same way: the write is done when the part holds every record it sent, or a newer
  one.
- **Same state, first record kept.** Where the merged result would replace the server's record of
  an occurrence with one of the same `status` and `note`, the write sends the server's record
  instead: the occurrence was already in that state (a screen or notification that was out of
  date), and the record of whoever logged it first stays. The merge itself (6.3) is unchanged.
- A carrier this version cannot read is never written (section 10.7).

### 6.9 Shared routines

A routine can be shared with the people of a project the user already shares (section 9.1).
Apps never create or share a project for it.

- **Flag.** `definition.shared: true` marks a shared routine; missing or `false` means private.
  Only the routine's **owner**, the user who created its main carrier (`created_by`), changes it.
- **Where it lives.** The main carrier and its archive parts are in the project the routine is
  shared through. Everyone who can see that project sees the routine: its direct shares, the
  members of a team it is shared with and the people a parent project is shared with. A flagged
  routine whose project has no other members (section 9.1) behaves as private: no shared mark,
  no names.
- **Who reads it.** Section 10.3 has one exception: a main carrier another user created is read,
  merged and written when its definition has `shared: true`. An archive part counts when its
  `routineId` belongs to a routine the app reads, whoever created it: a part a member wrote while
  the routine was shared stays part of its history after the owner stops sharing it (routine ids
  are random, so no other routine's part has that id). Other users' private routines, archive
  parts of routines the app does not read, and every other kind of hidden task of another user
  stay ignored.
- **Sharing** (the owner, online only): first move the archive parts into the project (a merge
  patch with `project_id`), then one carrier write (6.8) that also has
  `{"op": "replace", "path": "/project_id", "value": <project id>}` and sets the flag. **Stopping**:
  one carrier write that clears the flag and moves the carrier to the owner's Inbox, then move
  the archive parts there. Moving a shared routine to another project is sharing it again.
- **Which people.** The people a routine can be shared with are the members (9.1) of the
  **eligible** projects: shared, not archived, and the user's permission there 1 or 2. A person
  whose permission (9.1) is 0 in every eligible project is listed but cannot be picked ("Can view
  only"). When the person picked is in one eligible project the routine goes there; when they
  are in several, the user picks the project, and the one the routine is already in comes first.
- **Who can do what.**

| | Owner | Member with permission 1 or 2 | Member with permission 0 |
|---|---|---|---|
| See it, its status and its history | yes | yes | yes |
| Complete, skip or undo an occurrence, whoever logged it | yes | yes | no |
| Edit name, times, schedule, icon and colour | yes | yes | no |
| Reminders | yes | yes, unless turned off for themselves | none |
| Hide it for themselves | no | yes | yes |
| Stop sharing, move, archive, delete | yes | no | no |

- **Who logged it.** A person's change to an occurrence of a shared routine writes
  `"loggedBy": {"userId": <their user id>, "deviceId": <the record's modifiedBy>}` on the record.
  Apps name the person only when `loggedBy.deviceId` equals the record's `modifiedBy`, because a
  version that does not know `loggedBy` keeps the old one when it logs the slot again; otherwise
  they name nobody. Placeholders (6.3) and private routines have no `loggedBy`.
- **Per person.** Turning the reminders of a shared routine off, and hiding it, are the account's
  own synced preferences (`routine_reminders.<routineId>`, `routine_hidden.<routineId>`, section
  11.3), never part of the routine. A hidden routine leaves that person's lists, widgets and
  reminders, and the routine settings list it so it can be shown again.
- **Texts.** The control is "Share with", with "Only you" first and each eligible person by display
  name (9.3). Under it: "Visible to you and Maya" (9.3, everyone in the project), and "Kept in
  {project}", or a "Keep in" choice listing the eligible projects, each with its "Visible to" line
  and "Yours" on the user's own projects. A member sees "Shared by Maya" instead of the control.
  The explanation next to the label: "A shared routine is kept in a project you share with that
  person, so everyone in that project can see it and tick it off. Only people you already share a
  project with are listed; to share with someone else, share a project with them first, in Vicu or
  in Vikunja. Deleting that project deletes the routine and its history for everyone, and if you
  lose access to the project, you lose the routine." A shared routine's card says "Shared with
  Maya" ("Shared with Maya and Sam", "Shared with Maya, Sam and Lee"; the owner's view) or "Shared
  by Maya" (a member's view). A finished occurrence of a shared routine says "Done by Maya",
  "Skipped by Maya", "Done by you" or "Skipped by you". Deleting a project that holds shared
  routines adds "It also holds the shared routine "Feed the cat". Deleting the project deletes the
  routine and its history for everyone." ("the shared routines "A" and "B"" for more), and that
  question is asked even when the app's delete confirmations are turned off; archiving it adds
  "Shared routines in it can't be ticked off until it is restored."
- **Vectors.** The `routine-archive-v1.json` blocks `writeKeep` (the same-state rule of 6.8),
  `sharedVisibility` (which carriers and archive parts an app reads) and `loggedBy` (when a name is
  shown); the placeholder rule is in `merge`.

---

## 7. Completion hold

When the user completes a task in a list, the row does not vanish at once. The completion itself
is written immediately (`{ done: true }`); the hold only decides how long the row stays visible,
so the user can see what happened and change their mind. Constants (the fixture block
`completion`): hold 5000 ms, toast 6000 ms, toast text "Completed" for one task and
"{n} completed" for two or more, action label "Undo".

### 7.1 States

A completed row is **held** (still in the list, shown as done) or **collapsed** (gone from the
list, still done on the server). An open row that is completed becomes held; a held row becomes
collapsed; a held row can go back to open (undo).

### 7.2 Hold

- The hold ends **5 s after the later of the completion and the last moment the row stopped
  being engaged**. A row is *engaged* while the pointer is over it or keyboard (or assistive)
  focus is on it. While engaged the hold cannot end; when both the pointer and the focus have
  left, a full 5 s starts again.
- Engagement is tracked from before the completion: a row completed with the pointer already on
  it is engaged, so its hold starts when the pointer leaves. Completing with the keyboard and
  moving focus to the next row at once starts the 5 s at that moment.
- **Leaving the view** (navigating to another list or screen) ends every hold at once: all held
  rows collapse at that instant, whether or not they are engaged.
- Completing a row that is already held or collapsed does nothing (the first deadline stays).
- Undoing a held row (unchecking it) sends `{ done: false }`, returns it to open and cancels its
  hold; no toast is shown.

### 7.3 Toast

- When a row collapses, it joins the toast: if no toast is showing a new one appears with
  "Completed" and Undo; if one is showing, its count grows ("2 completed", "3 completed") and
  its 6 s clock restarts.
- While the pointer is over the toast or focus is on it, it cannot expire; when both have left,
  a full 6 s starts again (the same rule as the hold).
- When the clock runs out the toast disappears; the rows stay collapsed.
- Undo on the toast sends `{ done: false }` for every row the toast covers, returns them to open
  and removes the toast. Rows that are still held are not affected and are not in the toast.
- A completion after the toast is gone starts a new toast with "Completed".
- The toast survives navigation; leaving the view only collapses the held rows (and adds them to
  the toast).

### 7.4 Vectors

`completion.vectors` in the fixture are event sequences. Times are milliseconds from the start
of the sequence. Events: `complete`, `hoverStart`, `hoverEnd`, `focusIn`, `focusOut` (a row id in
`row`, or `"target": "toast"`), `navigate`, and `undo` (`"via": "row"` with a row id, or
`"via": "toast"`). Each `expect` entry is the state after every event up to and including its
`at`, with the timers due at that time already fired; a timer due at the same instant as an event
fires first. `held` and `collapsed` are row ids in ascending order, `toast` is the text shown or
`null`. Rows in the vectors start open.

---

## 8. Date display

This section says how a due date (or a completion time) is phrased. It applies to both apps; the
fixture block `dateDisplay` pins the exact strings for `en-US` and `en-GB`.

### 8.1 Inputs

- **Day difference** `diff`: the number of calendar days from today's local date to the local
  date of the value (negative for the past), computed on dates, never from a count of 24-hour
  blocks, so a day with a daylight-saving change is still one day.
- **Date only** as in section 1.2: local 23:59:59, or legacy 00:00:00. Any other time is a
  time of day.
- **Current year**: the year of today's local date. The year is shown only when the date's year
  is different.
- **Locale**: the system (region) locale on both apps. **Clock**: 12-hour or 24-hour. Android
  follows the system setting. Desktop takes the hour cycle of the system locale
  (`app.getSystemLocale()`) and has a Settings choice (System, 12-hour, 24-hour) for an OS custom
  format the web engine cannot see.

### 8.2 Strings

The text is built from parts, not from platform date formatters, so ICU on desktop and
`java.time` on Android give the same result. The English names, the per-locale patterns and the
words are in the fixture (`dateDisplay.names`, `.patterns`, `.words`). Spaces are plain U+0020.
September is "Sep". For `en-US` the order is month, day ("Oct 18"); for `en-GB` day, month
("18 Oct"). Clock: 24-hour is `HH:mm` ("09:05", "15:00"); 12-hour is `h:mm` plus a plain space
and the marker, `AM`/`PM` in `en-US` and `am`/`pm` in `en-GB` ("3:00 PM", "3:00 pm", "12:05
AM"). Other locales follow the same phrase structure with the platform's own order and
separators; only `en-US` and `en-GB` are pinned. The words ("Today", "Yesterday", "Tomorrow",
"{n} days ago") are the app's strings.

A **day phrase** is a short date (`dayMonth`, `dayMonthYear` when the year differs) or a weekday
date (`weekdayDayMonth`, `weekdayDayMonthYear`: "Sat 10 Oct", "Sat, Oct 10"). **Appending a
time**: when the value has a time of day, the text is the day phrase, a comma and a space, and
the time ("Fri, 15:00", "Oct 18, 3:00 PM"). A date-only value has no time part.

### 8.3 Contexts

| Context | Rule |
|---|---|
| `row` | `diff` of -7 or less: short date. -6 to -2: "{n} days ago". -1: "Yesterday". 0: "Today". 1: "Tomorrow". 2 to 6: the short weekday ("Fri"). 7 or more: short date. Then append the time, if any. |
| `row.inToday` | Like `row`, except a value dated today shows nothing when date only and just the time otherwise. |
| `row.inDayGroup` | The time only, if any, otherwise nothing. |
| `chip` | Always the weekday date, never a relative word: "Sat 10 Oct, 15:00" or "Sat, Oct 10, 3:00 PM"; date only: "Sat 10 Oct". |
| `header.day` | 0: "Today". 1: "Tomorrow". 2 to 6: weekday and day number ("Fri 9"). Otherwise the weekday date ("Mon 12 Oct", "Mon, Oct 12"). No time. |
| `header.full` | "Wednesday 7 October" or "Wednesday, October 7", with the year when it differs. |
| `logbook.group` | The group of a completion time. 0 or later: "Today". -1: "Yesterday". -6 to -2: the weekday date ("Mon 5 Oct"). -7 or older: the month and year ("September 2026"), always with the year. |
| `logbook.time` | The time of the completion in the user's clock. |
| `comment.day` | The day divider of a comment thread (section 9.5). 0 or later: "Today". -1: "Yesterday". Otherwise the weekday date ("Mon 5 Oct", "Tue 29 Dec 2026"), with the year when it differs. |

For the logbook and comment contexts the value is a moment that has happened (a completion, a
comment's creation) and is never date only. A value later than now (a clock that is a little
ahead) counts as today. A comment's time on its name line uses `logbook.time`.

### 8.4 Vectors

`dateDisplay.vectors` carry `now` and `due` as local wall-clock times in `zone` (without an
offset, as elsewhere in this document), `locale` (`en-US` or `en-GB`), `hour12`, `dateOnly`,
`context` and the expected text. They cover every context, both locales with both clocks, the
boundaries between the phrases, the year boundary in both directions and the days around daylight
saving changes in Pacific/Auckland and America/New_York. No vector uses a time inside a
transition hour.

---

## 9. Collaboration

Assignees and task comments for a household of a few people. Everything here is data Vikunja
2.4 already keeps; Vicu stores nothing of its own on the server. The fixture block
`collaboration` pins the rules that are data; the endpoints and the error answers below were
checked against a 2.4.0 server.

Not part of it, because the API has no such thing: presence or typing, an activity log ("Maya
completed ..."; `done_at` has no author), threaded replies, files on comments (files stay task
attachments), push delivery and a "household" object. Reactions exist in the API and are left out
on purpose.

### 9.1 Members and the shared rule

- The **members** of a project are the answer of `GET projects/{id}/users/search` with an empty
  `q`: the owner, the people it is shared with directly, the members of the teams it is shared
  with, and the people a parent project is shared with (sharing a project shares its subprojects;
  their own share lists stay empty).
- A project is **shared** when its members include someone whose user id is not yours. Sharing is
  the switch: assignees, comments and their signals appear only on tasks of shared projects. A
  project nobody else can see shows nothing new, and an app whose user shares nothing looks and
  fetches exactly as before. (The share lists alone are not enough: a subproject of a shared
  project has none of its own, and a team that holds only you shares nothing.)
- Apps keep the members with the project list, refresh them at most every 10 minutes and at once
  after a share change, keep the last answer while offline, and drop them on an account change.
  A project whose members are not known yet counts as not shared.
- **Your permission** on a project is its `max_permission` (`GET projects?expand=permissions`):
  0 read only, 1 read and write, 2 admin. An archived project counts as read only. Unknown counts
  as read and write.
- **A member's permission**, for the "Can view only" note: 2 for the owner of the project or of
  one of its parent projects; otherwise the highest permission among the direct shares
  (`GET projects/{id}/users`) and the team shares whose `members` include them
  (`GET projects/{id}/teams`) of the project and all its parent projects. Unknown (no share
  found) counts as read and write. Fixture: `collaboration.memberPermission`.

### 9.2 Who can do what

| Your permission | Assign | Comments | Share |
|---|---|---|---|
| 0, read only | the chip shows the assignees but does not open | read; no composer, "You can read comments in this project" instead | no |
| 1, read and write | yes | read, write, edit and delete your own | no |
| 2, admin | yes | as 1 | yes |

- Read-only members are listed in Assign but cannot be picked: disabled, with "Can view only".
  (The server would accept them; the rule keeps a task with someone who cannot act on it.)
- **Assign for a selection** (the selection's menu, "Assign..."): offered only when every
  selected task is in a shared project where you may write. It lists the members of all those
  projects (usually one), ordered as in 9.3. A person assigned to every selected task is ticked,
  to some of them partly ticked. Picking a person who is not ticked, or partly ticked, assigns them
  to every selected task that lacks them; picking a ticked person removes them from all. Each
  change is the single task's assign or unassign (section 9.6 queues it offline). A read-only
  member stays disabled unless they are assigned to one of the tasks, so they can be removed.
- Only the author may edit or delete a comment. Apps show Edit and Delete on your own comments
  only; Edit only on a comment in the plain form (section 9.5).
- Comments on done tasks stay readable and writable.

### 9.3 People and names

- A user's **display name** is `name`, trimmed, when it is not empty; otherwise `username`.
- **Order**: wherever people are listed (assignee avatars and names, the Assign list, the
  "Visible to" line), you come first, then the others in the order the server returned them.
  Mention suggestions leave you out.
- **Name list**: display names joined with ", ", with "You" for yourself: "You, Maya".
- **Visible to**: "Visible to you" for one member, "Visible to you and Maya" for two, "Visible to
  you, Maya and Sam" for more ("and" before the last; "you" in lower case).
- **Accessible names**: the row's avatars "Assigned to you, Maya" (the name list with "you" in lower
  case); the open task's chip "Assigned: You, Maya", or "Assign" when nobody is assigned; the
  comment count "1 comment", "4 comments", with ", new" when unread ("2 comments, new").
- **Avatars**: `GET avatar/{username}?size=N`, cached per user for the session. It answers an image
  of any type (the default "initials" provider answers SVG) and a placeholder for an unknown user.
  Until it arrives, or when it fails, the app draws the first letter of the display name in upper
  case on a neutral fill. An avatar is decoration: it never carries meaning on its own.

### 9.4 Signals on tasks

- `assignees` is always on a task. `comment_count` and `is_unread` come only with
  `expand=comment_count&expand=is_unread` (the parameter is repeated; a comma-separated value is
  refused) and are left out of the answer when 0 and false. Apps add the two expands to task list
  requests only while at least one project is shared.
- `is_unread` is raised for every member except the author when a comment is added (a mention
  raises it too; an assignment does not). `PUT tasks/{id}/read` clears it; it is idempotent. Apps
  call it when the comments of a task open and clear the flag locally at once.
- **Never put `assignees` in a task merge patch.** Assign is `POST tasks/{id}/assignees
  {"user_id": N}` (an already assigned user answers 400 with code 4021, which counts as done);
  unassign is `DELETE tasks/{id}/assignees/{userId}` (idempotent). Assigning someone also
  subscribes them to the task on the server.
- The row signals and their order are in `design-system-v1.md` section 4. An unassigned task with
  no comments in a shared project looks exactly like a task in a private project.
- Custom lists can select tasks by assignee, comments, shared project and recent change
  (section 3.3).

### 9.5 Comments

- **Reading**: `GET tasks/{id}/comments?order_by=desc&per_page=50&page=N`, shown oldest first:
  page 1 holds the newest 50 and older pages load when the thread is scrolled to the top. The
  thread opens scrolled to the end.
- **Writing**: `POST tasks/{id}/comments {"comment": html}`; edit with a merge patch
  `PATCH tasks/{id}/comments/{commentId} {"comment": html}`; `DELETE tasks/{id}/comments/{commentId}`.
  A comment is **edited** when its `updated` is at least one second after its `created` (the
  server stamps both on create, a few microseconds apart): the name line adds " · edited".
- **Day dividers** use the `comment.day` context of section 8 on `created`; the name line shows the
  `logbook.time` of `created`.
- **Mentions** notify only as an element. Vikunja's own editor and its Markdown import write
  `<mention-user data-id="{username}" data-label="{label}">@{username}</mention-user>` (the web
  editor leaves the element empty). Plain "@username" text notifies nobody. Apps write the element
  and never send Markdown.

**Comment HTML from text** (what the composer sends; fixture `collaboration.encode`):

1. Line breaks (`\r\n`, `\r`) become `\n`; spaces, tabs, no-break spaces and line breaks at the
   start and end of the whole text are removed. Empty text is not sent.
2. A **mention** is an `@` at the start of the text or after a character that is not a letter, a
   digit or `_`, followed by the username of a member (compared without case) and then by the end
   of the text or a character that is not a letter, a digit or `_`. Members are tried longest
   username first; the first that fits wins. Letters are the Unicode letter categories, digits the
   decimal digits; characters are UTF-16 units. It becomes the element above with the member's own username in `data-id` and in the text,
   and the display name in `data-label`. Anything else that starts with `@` is text.
3. Text is escaped: `&` `&amp;`, `<` `&lt;`, `>` `&gt;`, `"` `&quot;` (attribute values the same).
4. The lines are joined with `<br>` and wrapped in one `<p>...</p>`.

**Text from comment HTML** (what the thread shows; fixture `collaboration.decode`):

- A `mention-user` element is a mention of its `data-id`, shown as "@" and the display name of the
  member with that username, else its `data-label`, else its text without the leading "@", else
  the `data-id`. Its content is not shown otherwise.
- `<br>` is a line break. The end of a `p`, `div`, `li`, `blockquote`, `pre` or `h1` to `h6` element
  is a line break when more text follows. Every other tag is dropped and its text kept, except
  `script` and `style`, whose content is dropped. Character references are decoded (`&amp;`
  `&lt;` `&gt;` `&quot;` `&#39;` `&apos;` `&nbsp;` and numeric ones; any other stays as written). A
  line break character inside text is a space. A `<` that does not start a tag, a comment or a
  declaration (`<` followed by a letter, `/`, or `!`) is text.
- A pending line break from the end of a block is written once, before the next text, mention or
  `<br>`, however many blocks ended, and only when something was written before it. Text made only
  of whitespace while a line break is pending (the indentation between blocks) is dropped.
- Spaces, tabs, no-break spaces and line breaks at the start and end are removed. Plain
  "@username" text stays text.
- A comment is in the **plain form** when its only elements are `p`, `br` and `mention-user`. Only
  those can be edited in Vicu: the editor gets the text with each mention as "@" + `data-id`, and
  saving encodes it again as above. Other comments (rich text from Vikunja's web editor) are
  shown as text and can be deleted, not edited, so no formatting is lost.

**Mention suggestions** (fixture `collaboration.mention`): while the text before the caret ends
with an `@` that is at the start or after whitespace, followed by zero or more characters that are
not whitespace and not `@`, those characters are the query. Suggestions are the members other than
you whose username, display name or a word of the display name starts with the query (without
case), in member order. Picking one replaces the `@` and the query with `@{username} ` (one
space), and the caret moves after the space.

### 9.6 Offline

- Assign, unassign, a new comment, an edited comment and a deleted comment are queued like label
  changes when the server cannot be reached or the task has changes waiting, with a new entity
  type `comment`. They replay in order with the task's other changes, after the task's own create.
- Folding: assigning and then unassigning the same user (or the reverse) before the queue is sent
  cancels both; an edit of a comment that is still waiting to be created goes into the create; a
  delete of such a comment removes the create; two edits of one comment keep the last text; a
  delete after an edit replaces the edit.
- A comment written offline has a negative temp id until its create replays and appears in the
  thread at once with "Waiting to sync" in place of its time.
- Replay answers: an assign answered 400 with code 4021 (already assigned) is done; an unassign
  is idempotent; a comment delete answered 404 is done; a 403 on any of these moves the action to
  the failed log (the user may no longer write to the project) instead of stopping the queue, and
  so does a 401 to a token that still works (section 9.7); a 404 on a comment create or edit moves
  it to the failed log.
- Subscriptions and "mark read" are not queued: a subscription change needs the server's answer,
  and a read that does not reach the server is simply repeated the next time the comments open.

### 9.7 Notify me and sharing

- "Notify me" is the task subscription: `task.subscription` (present only on a single-task read,
  `GET tasks/{id}`) is on when it is not null. `POST subscriptions/task/{id}` turns it on (412
  with code 12002 means already on, which counts as done); `DELETE subscriptions/task/{id}` turns
  it off. Apps toggle it optimistically and put it back with a message when the server refuses.
- Sharing (admins only): find the person with `GET users?q={username}`, which matches a username
  exactly (names and emails match only people who made themselves discoverable); share with
  `POST projects/{id}/users {"username", "permission"}` (default 1; 409 code 7002: already has
  access; 404 code 1005: no such user); change with `PUT projects/{id}/users/{username}
  {"permission"}`; remove with `DELETE projects/{id}/users/{username}`. The owner cannot be added.
  Team shares are listed read only and are managed in Vikunja. A change refreshes the project's
  members at once; when a project stops being shared, its chips and signals go and an open comments
  pane or screen closes.
- **API tokens.** Vikunja does not offer API tokens the `subscriptions` route group, so with a
  token every Notify me call answers 401: apps signed in with an API token do not offer Notify me.
  A token can also lack a route group this section uses (`tasks_comments`, `tasks_assignees`,
  `projects_users`, `projects_teams`), and the server answers that with 401 as well (checked on
  2.4.0). A 401 means the session ended only when the same token is also refused
  `GET projects?per_page=1` (the project list every app reads); otherwise it refuses that one
  request. The app stays signed in and says that the token lacks the permission (and that signing
  in with a password avoids it), and a queued action refused that way goes to the failed log.

### 9.8 Vectors

`collaboration.shared` gives `me` and the member ids. `memberPermission` gives a project tree
(`id`, `parent`, `owner`), the direct shares and team shares per project id, and the project and
user asked about; `null` means unknown. `names` gives `me`, the people in server order and the
expected name list, "Visible to" line and the two accessible names. `countLabel` gives a count,
the unread flag and the text. `encode` gives the text, the members and the HTML. `decode` gives the
HTML, the members and the expected `segments` (`{"text"}` and `{"mention", "label"}`, adjacent
text merged), the `plain` flag and, for plain comments, the `editText`. `mention` gives the text,
the caret (a UTF-16 offset), `me`, the members, the expected `query` (or `null`), the suggested
usernames and, when `pick` is set, the text and caret after picking that username. `edited` gives
`created`, `updated` (UTC instants) and the flag.

---

## 10. Hidden tasks

Vicu keeps the data that must reach every device in ordinary Vikunja tasks that both apps hide
("hidden tasks", "carriers"): the custom-list carrier (section 3), routine carriers and archive
parts (section 6) and the preferences carrier (section 11). These rules hold for every kind.

### 10.1 Marker and hiding

- The marker is `<!-- vicu-<kind>:v<N>:<payload> -->` in the task description. `<kind>` is
  lowercase letters, digits and hyphens, optionally followed by a colon-separated sub-kind
  (`routine:archive`). `<payload>` is UTF-8 JSON in base64url without padding.
- A task is **hidden** when its description matches `<!--[ \t\r\n]*vicu-[a-z0-9-]+:` (case
  sensitive; only those four whitespace characters), whatever the kind, known or not. That lets a
  later version add a kind without older versions showing it. The title never decides.
- Every list, count, badge, search and widget leaves hidden tasks out by this test, never by
  `done` alone: a hidden task someone reopened in Vikunja's web UI stays hidden.

### 10.2 Shape

- A hidden task is created **done**, in one request, with the null due date, no repeat, no
  reminders, no labels and no assignees, and is never positioned in a list view.
- Every write sends `done: true`, `due_date: "0001-01-01T00:00:00Z"`, `repeat_after: 0`,
  `repeat_mode: 0` and `reminders: []` again, so an edit made in the web UI is undone.
- A **reopened** hidden task is still the same carrier: apps keep using it and the next write marks
  it done again.

### 10.3 Ownership

- A hidden task belongs to the user who created it (`created_by.id`, set by the server; a task
  created over an API token belongs to the token's user). An app reads, merges, writes and deletes
  only its signed-in user's hidden tasks. Other users' hidden tasks stay hidden and are otherwise
  ignored, so a shared project never mixes two people's data.
- One exception: a routine its owner shared (section 6.9) is read, merged and written by the
  people of its project, and the archive parts they wrote for it stay with the routine.
- Until the app knows its user id (`GET user`), it does not discover carriers.

### 10.4 Placement and discovery

- New carriers go in the Inbox project (section 11.4). Discovery covers every project.
- Apps remember carrier ids per server and kind and fetch them by id, done or not. They search
  `GET tasks?q=<kind search>` (no `done` filter) at most once a minute and whenever no id is
  known, and list all done tasks when a remembered id answers 404 or 403 and once a day. A task
  found is a carrier when its description has that kind's marker and the user created it.
- A search the server answers with an error other than 401 finds nothing new: what the last
  listing of all done tasks found stands until the next one. (Vikunja on a ParadeDB `pg_search`
  extension older than its library answers every search with 500 while plain listings work.) A
  read that needs every carrier or archive part at once lists all done tasks instead. A search
  that gets no answer, or a 401, is still a failure.
- Vikunja 2.4 leaves tasks of archived projects out of every list and search (a remembered id is
  still fetched) and refuses writes there with 412. A carrier in an archived project is
  therefore read only, and a device that does not remember it creates a new one.

### 10.5 Duplicates

- Every own carrier of a kind is read and merged into the local copy; the one with the lowest id
  is written.
- After a successful write, each other own carrier is fetched again and deleted when
  `prune(merge(kept, extra))` equals `kept` (section 10.6), so it holds nothing the kept one lacks.
  A malformed carrier or one with a higher version is never deleted.

### 10.6 Revisions and tombstones

- Documents made of records stamp each record with a revision
  `{ "wall_time_ms", "counter", "device_id" }`, compared in that order (`device_id` as a string);
  the newer record wins a merge.
- A record with `"value": null` is a tombstone (a deletion, or a reset to the default). Before
  writing and before comparing a merge result with the server's copy, apps drop every tombstone
  whose `wall_time_ms` is earlier than now minus 90 days (7,776,000,000 ms). A device offline for
  longer may bring a deleted record back; that is accepted so documents stop growing.

### 10.7 Versions and damage

- A carrier whose marker version or payload `version` is higher than the app knows makes that
  kind read only with "update required"; it is never written or deleted.
- A write that needs the server's copy and cannot read it (a higher version, or malformed) is not
  sent.
- A malformed carrier is ignored and reported; the valid ones are still used.

### 10.8 Unknown data and size

- Fields an app does not know are kept at every level of every payload (documents, records,
  values, filters, routine definitions, slots, occurrences, archive parts) and written back
  unchanged. A merged record keeps the winning side's unknown fields. Unknown fields at the top
  level of a document are the union of both sides; for a field on both sides the server copy's
  value is kept.
- The decoded JSON stays within 384 KiB when written; 512 KiB is the most an app accepts.

### 10.9 Vectors

`hiddenTasks.markers` gives a title, a description and whether the task is hidden.
`hiddenTasks.ownership` gives the signed-in user id (`null`: not known yet), carriers with
`createdBy`, the ids used and the id written. `hiddenTasks.tombstones` gives `nowMs`, records with
`wallTimeMs` and whether they hold a value, and the ids kept.

---

## 11. Synced preferences

Settings that change what a list shows or how input is read are the same on every device of an
account. They live in one carrier per account.

### 11.1 Carrier

- Title `Vicu preferences (sync metadata — do not delete)`, marker `vicu-prefs:v1`, search text
  `vicu-prefs`. Section 10 applies.
- It is created, in the Inbox project, only once the document holds an entry: a device that never
  changed a synced setting never creates one.

### 11.2 Document

```json
{
  "version": 1,
  "entries": {
    "task_order": {
      "value": "due_date_first",
      "revision": { "wall_time_ms": 1792000000000, "counter": 0, "device_id": "4f1c" }
    },
    "task_order.project.7": {
      "value": null,
      "revision": { "wall_time_ms": 1792000900000, "counter": 1, "device_id": "9a07" }
    }
  }
}
```

- `value` is any JSON value; `null` means "the default" (a reset reaches every device).
- **Merge** `merge(local, server)`: the union of keys; for a key on both sides the newer revision
  wins (section 10.6), and equal revisions keep the server's entry. Tombstones are pruned as in
  10.6.
- **Defaults are never written.** A key without an entry uses its default; only a choice the user
  makes writes an entry, so a new device cannot overwrite anyone's settings with its defaults.
- **Unknown keys and values are kept.** A key this version does not know is kept and not used. A
  value it cannot use (wrong type, or a value a newer app added) reads as the default and is kept
  unchanged.
- Per-project keys are `<setting>.project.<id>`. They stay when the project is deleted.

### 11.3 Registry

A key is added here, in both repos, in the release that starts writing it.

| Key | Value | Default |
|---|---|---|
| `inbox_project_id` | the Inbox project id, a whole number above 0 | none: the app asks during setup |
| `task_order` | a task order key (section 12.1) | `due_date_first` |
| `task_order.project.<id>` | a task order key, or `null` | follows the parent project, then `task_order` (section 12.3) |
| `place.<placeId>` | a saved place's name, `{"name": "Home"}`, or `null` (deleted); section 11.7 | none |
| `location_reminder.<taskId>` | a task's location reminder, `{"place", "trigger", "radius_m"}`, or `null`; section 11.7 | none |
| `routine_reminders.<routineId>` | `"off"`: no reminders of that shared routine on this account; or `null`. Any other value acts as the default and is kept; section 6.9 | on: the routine's own reminder settings |
| `routine_hidden.<routineId>` | `true`: that shared routine is hidden on this account; or `null`. Any other value acts as the default and is kept; section 6.9 | shown |
| `category.<categoryId>` | a project category, `{"name", "order"}`, or `null` (deleted); section 13 | none |
| `category.project.<projectId>` | the id of the category a top-level project is in, or `null`; section 13 | no category |
| `project_icon.<projectId>` | `"none"`: the project is drawn without its folder icon and its name starts where the icon would be; or `null`. Any other value acts as the default and is kept | the folder |
| `weekly_review.last` | the local date the last weekly review was finished, `"YYYY-MM-DD"`; section 14.7 | never done |

### 11.4 The Inbox

- The Inbox project is a synced entry. A device without an entry asks during setup and writes
  the answer. Vikunja's `default_project_id` (`GET user`) may be the preselected answer; apps never
  write Vikunja's user settings.
- At setup, after sign-in, apps read the preferences carrier before asking for the Inbox, so the
  synced Inbox is preselected.
- An Inbox that does not exist or cannot be read any more is asked for again.

### 11.5 Making an existing setting sync

When a release starts syncing a setting that apps already kept on the device, each device, after
its first successful read of the carrier, writes its local value as an entry only when the value
differs from the default and the carrier has no entry for the key (a `null` entry counts as an
entry). If two devices do this at once, the later write wins. For the Inbox, which has no
default, the first device to update decides for every device of the account.

### 11.6 Vectors

`syncedPrefs.merge` gives `local`, `server` and the merged document. `syncedPrefs.read` gives
entries, a key and the value an app uses. `syncedPrefs.move` gives a key, the local value, the
carrier's entry (absent when not given) and whether the device writes.

### 11.7 Places and location reminders

A task can remind the user when they arrive at or leave a place they saved on a phone. The place's
**name** and the reminder sync; where the place is never does.

- `place.<placeId>`: `{"name": "<name>"}`. `<placeId>` is 1 to 64 letters, digits, `-` and `_`
  (phones use a random UUID). The name is the user's own text, not blank after trimming. `null`
  deletes the place.
- `location_reminder.<taskId>`: `{"place": "<placeId>", "trigger": "arrive" | "leave", "radius_m":
  <whole number 100 to 1000>}`, at most one per task. `<taskId>` is the server's task id, a whole
  number above 0: a key is never written for a task created offline (a temporary id); the phone
  holds that reminder until the task has its server id. `null` means the task has no location
  reminder.
- A value that does not have that shape reads as none and is kept unchanged (section 11.2), so a
  later version can add fields.
- **Positions stay on the phone.** Each phone keeps the latitude, longitude and address of the
  places it located, by place id; they are never sent anywhere. A phone that has a place's name but
  not its position shows it as not set on that phone and lets the user locate it there.
- **Only phones remind.** A phone watches a reminder when it knows the place's position, and
  notifies once on arriving or leaving (no notification for being there already when the reminder
  is set). Desktop shows and sets reminders at synced places but never creates a place.
- A reminder ends with `null`: when it fires, when the task is completed, deleted or no longer on
  the server, when the user removes it, and for every reminder at a place that is deleted.
- A reminder at a spot that is not a saved place (a searched address, the current position) stays
  on the phone that set it and is not synced.

---

## 12. Task order

How the tasks of a project are ordered in the project screen and its sections, the Inbox, and the
widgets that show a project or the Inbox. Today, Upcoming, Anytime and custom lists keep their
own order.

### 12.1 Orders

| Key | Order |
|---|---|
| `due_date_first` (default) | Dated tasks first by due date, then the undated ones in manual order |
| `due_date_priority` | Dated tasks first by due date, then the undated ones; within each, the highest priority first |
| `manual` | Every task in manual order (the position in the project's list view) |
| `priority` | The highest priority first, then as `due_date_first` |
| `title` | By title |
| `newest` | The most recently created first |
| `oldest` | The longest-standing first |

A value an app does not know acts as `due_date_first`.

### 12.2 Comparing tasks

- A task is **dated** when it has a due date that is not the null date. Due and created dates are
  compared as parsed instants, never as strings. A missing or unreadable created date comes last
  in both `newest` and `oldest`.
- Titles are compared lowercased (Unicode lowercase without locale rules), by UTF-16 code units.
- Priorities run 0 (unset) to 5; higher comes first.
- A missing position counts as 0.
- Every order ends with the position (lower first) and then the task id (lower first), so equal
  rows land in the same place on every device.

| Order | Keys, in turn |
|---|---|
| `due_date_first` | dated first; due date; position; id |
| `due_date_priority` | dated first; due date; priority; position; id |
| `manual` | position; id |
| `priority` | priority; dated first; due date; position; id |
| `title` | title; position; id |
| `newest` | created, newest first; position; id |
| `oldest` | created, oldest first; position; id |

### 12.3 Which order a project uses

Its own entry (`task_order.project.<id>`), else the entry of its nearest ancestor that has one
(walking `parent_project_id`; a cycle ends the walk), else `task_order`, else `due_date_first`.
A `null` entry is no entry; any other value is an entry, and one an app cannot use (a newer
order, or not a string) acts as `due_date_first` (section 12.1). The Inbox uses the order of the
Inbox project.

### 12.4 Dragging

In `manual` every row can be dragged; in `due_date_first` only undated rows, among themselves; in
the other orders none. The Move up and Move down actions follow the same rule.

### 12.5 Vectors

`taskOrder.tasks` gives tasks (`id`, `title`, `due` as a UTC instant, the null date or `null`,
`priority`, `position` (absent: 0), `created` as a UTC instant or `null`). `taskOrder.sort` gives an
order and the expected ids. `taskOrder.resolve` gives parents, entries and, per project, the order
used. `taskOrder.drag` gives an order and the ids that can be dragged.

---

## 13. Project categories

A user can group the top-level projects of the project list under named headers, such as "Work"
and "Home". Categories are optional: without one, the list is exactly as it is without this
section. They belong to the user and sync through the preferences carrier (section 11), so every
device of the account shows the same groups, and two people who share a project can each file it
in a category of their own. Vikunja knows nothing of them.

### 13.1 Keys

- `category.<categoryId>`: `{"name": "<name>", "order": <number>}`, or `null` (deleted).
  `<categoryId>` is 1 to 64 letters, digits, `-` and `_`, and never `project` (apps use a random
  UUID). The name is the user's own text, not blank after trimming; apps trim it before writing.
  `order` is any number, whole or not, negative or not (section 13.4 says how apps choose it).
- `category.project.<projectId>`: the `<categoryId>` of the category a top-level project is in, or
  `null` (no category). `<projectId>` is the server's project id, a whole number above 0.
- A value that does not have that shape reads as none and is kept unchanged (section 11.2). Other
  fields of a category are allowed and kept whenever an app writes it again (section 10.8).
- There is one key per category and one per project, so two devices that change different
  categories or projects never undo each other's change. Entries are small: the carrier's size
  limit (section 10.8) leaves room for thousands.

### 13.2 Top-level projects

- The project list holds every project that is not archived and is not the Inbox (the Inbox has its
  own place above it). A listed project is **top-level** when its parent is 0 or is not a listed
  project: archived, the Inbox, or not visible to the user. Every other listed project is a
  subproject and stays below its parent.
- A top-level project is in the category its own entry names when that category is usable: its
  `category.<categoryId>` entry has the shape of section 13.1. An entry that names no usable
  category (deleted, never there, or written in a shape this app cannot use) means no category.
- Only top-level projects use their entry, and nothing is inherited from a parent. The entries of
  subprojects, archived projects, the Inbox and deleted projects are kept and not used. A project
  that becomes top-level (moved out of its parent, or its parent archived) is in the category of
  its own entry, or in none.
- Projects caught in a loop of parents (a project below itself, or A below B below A), which the
  server should never allow, have no category and are not covered by the vectors.

### 13.3 Layout

- First come the top-level projects without a category, with no header. Then each usable category
  follows as a group: its header, then its top-level projects. Each project is followed by its
  subprojects, as without categories.
- Categories are ordered by `order` (lower first), then by name lowercased (as titles in section
  12.2), then by id (UTF-16 code units).
- Within a group, top-level projects are ordered by position (lower first; a missing position
  counts as 0), then by id (lower first), as without categories.
- A category without projects still shows its header, so a project can be moved into it.
- A header is only a heading: it has no list of its own. It can be collapsed to hide its projects.
  Which headers are collapsed is kept per device and never synced.
- The groups show in the project list of the drawer and the sidebar and in the project lists of
  Settings. A project picker may show the same headers in the same order. Every other list (smart
  lists, Anytime, Review, search, widgets, custom lists) keeps its own order and shows no
  categories.

### 13.4 Changes

Positions stay Vikunja's: a category only decides which group a top-level project is in, and its
position decides where it goes in that group. The **order step** is 65,536.

- **New category**: it goes last, with the highest order of the usable categories plus the step
  (just the step when there is none).
- **Moving a category**: it gets an order between its new neighbours: the first one's order minus
  the step at the start, the last one's plus the step at the end, otherwise the middle of the two.
  When those two neighbours are less than 1 apart, every usable category gets a new order instead:
  the n-th in the new display order (counting from 1) gets n times the step. Only categories whose
  order changes are written, and a category moved to where it already is writes nothing.
- **Renaming**: writes the category with the new name, trimmed. Its order and other fields stay.
- **Deleting**: writes `null` to the category and to every `category.project.<id>` that names it,
  whatever project that is (a subproject, an archived or a deleted one too). Its projects stay,
  without a category. Deleting a category never deletes a project.
- **Moving a project to a category** (or to none) from a menu writes its `category.project.<id>`
  (`null` for none) and nothing else: the project lands where its position puts it in that group.
  Dragging a top-level project, or a subproject out to the top level, past a header writes the
  same entry, and its position moves between its new neighbours in that group (in an empty group,
  after every top-level project). Nothing is written for a project that is already in that
  category.
- **Add category above** a top-level project (as a slide deck adds a section): the new category
  starts at that project. It is placed as a moved category would be: right after the project's own
  category, or before every category when the project has none (just the step when there is no
  other category). The project and every project after it in its group move into the new
  category. Apps do not offer it on the first project of a category, where it would only leave
  that category empty. On the first project without a category it moves all of those projects.

### 13.5 Vectors

`projectCategories.read` gives entries, a key and the value an app uses (`null`: none), as
`syncedPrefs.read` does. `projectCategories.layout` and the `split` changes run on
`projectCategories.projects` (`id`, `parent`, `position` (absent: 0), `archived` (absent: false);
`title` is only for the reader) with `inboxProjectId`. Each layout vector gives entries and the
groups in display order: a `category` (`null` for the projects without one, always first, even
when empty) and its top-level project ids. `projectCategories.changes` gives entries, an `action`
and every entry the app writes (`expectWrites`; a key that is not listed is not written). The
actions are `new` (`id`, `name`), `move` (`category`, `to`: its index in the new display order),
`rename` (`category`, `name`), `delete` (`category`), `assign` (`project`, `category`: a move from
a menu) and `split` (`project`, `id`, `name`: Add category above).

---

## 14. Guided organizing

Guided sessions take the person through their tasks one decision at a time. The app chooses what
needs a decision, shows one card (or one project) at a time with how far along they are, and the
person decides. Nothing here needs the assistant. With Ask set up, a model suggests a decision for
each card (`ai-assistant-v1.md`, section 9), and the person still decides. The numbers are in the
`guided.limits` block of the fixture.

### 14.1 Facts about a task

For a task and today's local date:

- `age_days` = today minus the local date of `created`.
- `untouched_days` = today minus the local date of `updated`.

A missing or unreadable timestamp gives null, and a rule that needs it does not match.

### 14.2 Queues

A session takes its queue when it starts: the task ids, in order. The card shows the task as it is
when the card comes; a task done or deleted by then is passed over. Hidden tasks (section 10.1)
and tasks the person cannot change (permission 0, or in an archived project; section 9.1) are never
in a queue.

| Queue | Tasks | Order |
|---|---|---|
| `inbox` | open tasks of the Inbox project | the Inbox's task order (section 12) |
| `overdue` | open overdue tasks (section 2) | due date, the oldest first; ties by id |
| `waiting` | open tasks outside the Inbox, without a due date, not repeating, with `untouched_days` of at least `waiting_days` | `untouched_days`, the highest first; ties by id; at most `waiting_max` |

### 14.3 Cards

A card shows the task's title, project, due date and labels, and how long ago it was added
("Added 3 weeks ago", 14.6). Its choices:

- **When**: the When panel's quick choices (Today, Tomorrow, This weekend, Next week), a date
  picked in the When panel, and No date when it has one.
- **Project**: any project the person can change that is not archived.
- **Title**: edited on the card.
- **Complete**, **Delete** (asked first when the person asks to confirm deletes) and **Skip**.

The choices made on a card are written together when the person goes on (**Next**), through the
usual paths: a merge patch with the changed fields, the project move, queued when offline. Next on
a card without changes is Skip. **Back** shows the previous card again, with its values as they
are now. Complete and Delete write at once and go on. The session ends with what it changed
("Sorted 12: 5 scheduled, 4 moved, 2 completed, 1 deleted") and **Undo all**, which puts back
every change except deletes.

### 14.4 Project review session

- The queue holds the projects due for review (section 4) that are not archived and that the person
  can change, without the Inbox when reviews leave it out. Order: never reviewed first, then
  `daysUntil` (lowest first), then path lowercased, then id.
- Each project gets one page, about its own tasks (a subproject is reviewed as a project of its
  own):
  1. Its path, when it was last reviewed, and the health line (14.5).
  2. **Still working on it?** Keep, or Archive (not offered for the Inbox). Archive goes on to the
     next project without marking this one reviewed.
  3. **Untouched**: its open tasks with `untouched_days` of at least `review_untouched_days`, the
     highest first, ties by id. Each can be kept, given a date or No date, completed or deleted,
     with the card's choices.
  4. **Next step**: the first open task in the project's task order, or the one the model suggests,
     with the When quick choices. The person can name a new task instead; it is created in the
     project.
  5. **Mark reviewed** records the review (section 4) and goes on; **Skip** goes on without it.

### 14.5 Health

A project's health line is built from its own open tasks, hidden tasks left out:

- `open`: the number of open tasks.
- `untouched`: open tasks with `untouched_days` of at least `review_untouched_days`.
- `overdue`: open overdue tasks (section 2).
- `scheduled`: true when an open task has a due date today or later.
- `last_done_days`: today minus the local date of the latest `done_at` among the project's done
  tasks the app has; null when it has none.

The line joins these parts with ` · `, in this order, leaving out a part whose condition fails:

| Part | When |
|---|---|
| `No open tasks` / `{open} open` | always: the first when `open` is 0 |
| `{untouched} untouched for {review_untouched_days}+ days` | `untouched` above 0 |
| `{overdue} overdue` | `overdue` above 0 |
| `nothing scheduled` | `open` above 0 and `scheduled` false |
| `last done {ago}` | `last_done_days` not null (14.6) |

### 14.6 How long ago

`ago(days)`: 0 `today`, 1 `yesterday`, 2 to 13 `{days} days ago`, 14 to 59 `{days / 7} weeks ago`,
60 to 729 `{days / 30} months ago`, from 730 `{days / 365} years ago` (whole numbers, rounded down).
A card says `Added {ago}`.

### 14.7 Weekly review

A checklist of steps in this order:

| Step | Title | What it shows | Count |
|---|---|---|---|
| `inbox` | Sort the Inbox | the `inbox` session | the `inbox` queue |
| `mind` | Anything on your mind? | brain dump when dictation is ready, otherwise quick add | none |
| `done` | Look back | tasks completed in the last 7 days (`done_at` local date today − 6 or later), the newest first | those tasks |
| `overdue` | Overdue | the `overdue` session | the `overdue` queue |
| `upcoming` | Look ahead | open tasks due from tomorrow to today + `look_ahead_days`, by due date then id | those tasks |
| `review` | Review projects | the project review session (14.4); left out while reviews are off | the review queue |
| `waiting` | Waiting a long time | the `waiting` session | the `waiting` queue |

- `done` and `upcoming` show tasks of projects that are not archived, hidden tasks left out; they
  are only looked at, and their rows open the task.
- **Next** opens the first step not done. Any step can be opened. A step is done when its session
  ends or the person marks it done; a step whose count is 0 is done from the start. `mind` is
  never done from the start.
- **Finish** is offered at any time. It writes `weekly_review.last` (section 11.3) with today and
  shows what the review changed.
- The weekly review is **due** when `weekly_review.last` is missing, unreadable, or at least
  `weekly_due_days` days before today.

### 14.8 Ask's agenda

When Ask opens on a conversation without messages, it lists these, in this order, each only when
its count is above 0 (the weekly review only while it is due):

| Item | Title | Count | Detail |
|---|---|---|---|
| `inbox` | Sort the Inbox | the `inbox` queue | `{n} waiting over a week` when `n`, the tasks of the queue with `age_days` of at least `inbox_age_days`, is above 0 |
| `overdue` | Sort out overdue | the `overdue` queue | none |
| `review` | Review projects | the review queue (14.4); none while reviews are off | none |
| `weekly` | Weekly review | none | `Last done {ago}`, or `Not done yet` |

Each item opens its session. The starters of `ai-assistant-v1.md` section 5.7 follow.

### 14.9 Vectors

`guided.world` holds one account's projects (`id`, `title`, `parent`, `archived`, `permission`,
`review`: `"never"`, `"excluded"` or `{"last", "cadence"}`) and tasks (`id`, `title`, `project`,
`done`, `due` and `due_time` (a local date and an optional `HH:MM`), `created`, `updated`,
`done_at` (local times), `repeats`, `position`, `hidden` (its description holds a marker)), with
`today`, `inboxProjectId` and the review settings. `guided.queues` gives each queue's ids,
`guided.health` each project's facts and line, `guided.weekly` each step's count (and the `done`
and `upcoming` ids), `guided.agenda` the items for a `weekly_review.last`, and `guided.ago` the
phrases.

---

## 15. Duplicating a task

Duplicate (the editor's menu, a task's context menu on the desktop, the selection's menu) makes a
new task from an existing one. Both apps copy the same things, so a copy made on either device is
the same task.

| Copied | Not copied |
|---|---|
| title (unchanged), description, due date, start date, priority, repeat (`repeat_after`, `repeat_mode`), reminders (absolute and relative), labels | done and `done_at` (a copy is always open), comments, attachments, relations other than subtasks, a location reminder (11.7), position |
| assignees, on a project that is shared (9.1) | |
| subtasks, duplicated the same way as open subtasks of the copy, nested ones included | |

- The copy goes to the same project, where any new task goes: the end of the project's order.
- It is created through each app's ordinary create, so it works offline; labels, assignees and
  subtasks follow the create the way they follow any new task. An app that links a subtask only
  once both tasks are on the server (the desktop) makes an offline copy without its subtasks and
  says so.
- Several selected tasks are each duplicated once; a selected subtask whose parent is selected too
  is only copied with that parent.
- Hidden tasks (section 10) are never shown, so they cannot be duplicated.
- **Copy titles** (the selection's menu) is something else: it puts the titles of the selected
  tasks on the clipboard, one per line, for pasting outside Vicu.
