# Events and calendars on the Plan screen: plan

Status: plan, November 2026. Proof of concept on branch `feat/calendar-poc` (commits `8cf9d84`, `ffd7854`).
Background research: `reports/Calendar sync for Plan screen.md` (not committed).

## Goal

One Plan timeline that shows everything that takes your time: your tasks' time blocks, your own **Events**
(typed by hand), and the events of the **calendars** you connect. Events and calendars are only on the Plan
screen (Day, 3 days, Week, Plan my day), never elsewhere in the app. They count as busy time for free time,
the next free slot, Fit and Plan my day.

## Principles

1. **Read-only.** Vicu never changes, adds to or deletes from a connected calendar. Only your own Events are
   Vicu's to change.
2. **Company data stays where the company put it.** Manual Events are the default answer for a work
   calendar. A calendar is connected only through a route the owner of the calendar controls (a share or
   publish setting, a phone's sync switch, an admin's consent), never around one.
3. **Least data.** Every calendar has "Show only Busy, not titles"; titles are dropped in the main process
   (Android: before the repository) before anything is stored or drawn. The assistant gets free time only,
   never titles.
4. **Connections belong to the device.** Links, passwords and tokens are encrypted on the device
   (Electron `safeStorage`, Android Keystore) and never synced, never sent to Vikunja, never in a log.
   Your own Events are synced (they are yours, and you want them on your phone too).
5. **One contract.** Desktop and Android read Events and busy time the same way, pinned by a contract
   section and fixture vectors, like every other shared rule.

## What is stored where

| Data | Where | Synced |
|---|---|---|
| Your Events (`event.<id>`: title, first day, time, length, repeat, until, skips, busy) | Synced preferences carrier on your Vikunja server | Yes, all your devices |
| Which calendars are connected, their links, passwords, tokens | Device: `userData/calendar-feeds.json` (desktop), Keystore-backed store (Android) | No |
| Per-calendar choices (shown, colour, counts as busy, Busy only) | Device | No (calendar ids differ per device) |
| Calendar event contents | Device memory plus a last-good cache on disk, titles already dropped for Busy only calendars | No |
| Anything about events in tasks, IndexedDB query cache, the assistant | Never (the assistant gets free minutes only) | - |

## Phase 0: the contract (both repos, one release)

New section **20. Events and calendars** in `docs/cross-app-semantics-v1.md`, vectors in
`cross-app-semantics-v1.json`, the same bytes in `vicu-android` (written, branch `feat/calendar-poc`
and `vicu-android` `feat/calendar-events`):

- **20.1 An event**, clipped to a local day. **20.2 Busy time** (extends 16.6). **20.3 Your Events**
  (`event.<id>`, registry 11.3). **20.4 The repeat rule.** **20.5 The repeat choices** and wording.
  **20.6 Changing an Event**: all times, this time only, this and following, skip, delete, Undo.
  **20.7 On the timeline.** **20.8 Busy only.** **20.9 Connected calendars.** **20.10 Importing a
  calendar file.** **20.11 Privacy.** **20.12 Vectors.**
- Vectors: `planEvents`, `eventBusy`, `eventChanges`, `icsImport`, run under Pacific/Auckland,
  America/New_York and the system zone.
- `design-system-v1.md` 4.2: the event look (striped tint of the calendar colour, left edge,
  tentative dashed, free fainter with its words kept, all-day chip, the colours) with contrast.

Desktop already follows most of this in the proof of concept; the fixture replaces the hand-written tests.

## Phase 1: Events, finished (desktop and Android, same release as phase 0)

Done in the proof of concept (desktop): drag, choose Event and a repeat; the popover (title, all day, time,
length, repeat, counts as busy, Skip this one, Delete with Undo); the list in the Plan gear and Settings;
synced storage; busy time for free time, next free slot and Fit.

Still to do, desktop:

- **Plan my day** counts Events and calendar events as busy (`planMeter`, `draftBlocks` take an event-busy
  input; `use-plan-session.ts` sends the reduced free time to the assistant, never titles).
- **Move and resize your own Events on the timeline** with the block gestures (this time only, or all
  times: the popover asks when the Event repeats).
- **Ends on** in the popover (sets `until`), and **This and following** (ends the series the day before
  and starts a new one) for a changed schedule.
- **New event without drawing**: the palette's "New event" and Ctrl+Shift+N on Plan, with the quick-add
  parser reading `Manager call every Tue 10:00 for 30m`.
- Keyboard: Enter opens an event (done), arrows move your own Event like a block.
- Harness: scenario `calendar-poc` becomes `plan-events` (id EVT), plus axe and forced colours.

Android:

- `PlanEvents.kt` (a line-for-line port of `plan-events.ts`, run against the same vectors), read from
  the synced preferences it already syncs.
- Drawn on `PlanTimeline` and the Today Day view with the same look; created from the draw sheet (Task /
  Event switch and Repeat), changed from an event sheet (the popover's fields).
- Busy time in its `TimeBlocks.kt` callers and Plan my day.

## Phase 2: connected calendars, read-only

Ordered by how many people each reaches per unit of work, and by how well it fits principle 2.

### 2a. Calendar links (ICS), desktop

Done in the proof of concept: add a secret `https://` or `webcal://` link (read once to check it), stored
encrypted; read at most every 5 minutes; ical.js parses and expands recurrence (RRULE, EXDATE,
RECURRENCE-ID, the feed's own time zones); shown, counts as busy and Busy only per calendar; remove.

Still to do:

- Keep the last good copy on disk (offline start, a failing feed keeps its events with "Not updated since").
- Conditional requests (`ETag`, `If-Modified-Since`) and read again on window focus and on Refresh (F5).
- Rename and colour per calendar; a clear error per calendar; a size and event-count limit.
- `VFREEBUSY` feeds (busy periods without events), which is what some free/busy shares give.
- Windows time zone names without a `VTIMEZONE` (map to IANA).
- The safeStorage change of Electron 45 (async availability check) for this store and the two existing
  ones, before upgrading past 45. On Linux without a keyring, say that links are only obscured.
- Help text per provider: Google (Secret address in iCal format), Outlook (Publish calendar), iCloud
  (Public calendar), Proton (Share via link, busy-only or full). For a work calendar: only if your
  organisation allows publishing, and prefer a free/busy share.

### 2b. The phone's calendars (Android)

The best route on a phone and the enterprise-safe one: whatever the phone already syncs, Vicu reads.

- `READ_CALENDAR` asked when you first open "Calendars" in Plan settings, with the reason; refusing
  leaves Events working.
- Pick calendars from the phone's list, grouped by account: Google, Exchange (through Outlook's "Sync
  calendars", which an employer's Intune policy may turn off: then Vicu sees nothing, as it should),
  iCloud and other CalDAV (through DAVx5), links (through ICSx5).
- `Instances` query for the days on screen (the provider expands recurrence), a `ContentObserver` to
  refresh, per-calendar shown, counts as busy, Busy only.
- No `WRITE_CALENDAR`. iOS: EventKit full access, the same choices, later.

### 2c. CalDAV accounts, desktop

For iCloud, Fastmail, Nextcloud, mailbox.org, Zoho, Posteo, Radicale, Baikal and other self-hosted servers.

- Add account: a preset (iCloud, Fastmail, Nextcloud, Other) or a server address, user name and an app
  password (with the provider's link to make one); discovery through `/.well-known/caldav`, then pick
  calendars.
- tsdav (MIT) for the DAV side, ical.js for the data; `sync-collection` with a full read when the token is
  refused; expansion done by Vicu, not the server.
- Read-only. Password encrypted like a link. Android uses 2b (DAVx5) instead of its own CalDAV client.

### 2d. macOS calendars through EventKit, desktop

Everything added in macOS Settings (iCloud, Google, Exchange, CalDAV) without a sign-in in Vicu. A Swift
helper like `native/voice-macos`; calendar usage strings and the calendars entitlement on the app.
Gate: a signed, notarized build must show the permission prompt as Vicu's and read events.

### 2e. Microsoft 365 and Google accounts, desktop (decision gate)

Only if 2a to 2d leave a real gap. Both use the existing browser sign-in pattern (loopback, PKCE, public
client) and poll with sync tokens (no server for push).

- Microsoft Graph: `Calendars.ReadBasic` and `offline_access`, read-only. Work accounts need publisher
  verification and often an admin's consent; show "your organisation needs to approve Vicu" and a page for
  IT (app id, permissions, data stays on the device). Never use another app's client id, EWS, passwords or
  web scraping.
- Google: `calendar.events.readonly` and `calendar.calendarlist.readonly` are sensitive scopes: OAuth
  verification (a verified domain, a privacy policy on it, a demo video), up to 100 users until then, 7-day
  tokens while testing. An advanced "use my own OAuth client" option for self-hosters.
- Decide after release A with real feedback: how many people ask for it that a link or a phone does not
  serve.

### 2f. Import a calendar file into Events (one time)

For a yearly schedule, school terms, public holidays, or a work schedule where policy allows exporting it.

- Open an `.ics` file; a preview lists what becomes Events: a series whose rule fits the repeat rule
  becomes one repeating Event, anything else becomes single Events for the next 12 months; "Busy only"
  drops titles at import.
- After import they are ordinary Events (synced, changeable); nothing stays linked to the file.

## Not planned

- Writing to a connected calendar, two-way sync, or tasks becoming calendar events. The research shows
  this is where task apps damage real calendars (deleted, shifted and duplicated events). If time blocks
  ever go out, it is a later, opt-in, one-way copy into a calendar Vicu creates and owns, tagged with the
  task id, never the user's own calendars.
- Events outside the Plan screen (Today, lists, Quick View, reminders).
- Showing event titles to the assistant.

## Releases

| Release | Desktop | Android |
|---|---|---|
| A | Contract 20; Events finished (phase 1); calendar links finished (2a) | Contract 20; Events (phase 1); phone calendars (2b) |
| B | CalDAV accounts (2c); macOS EventKit (2d); file import (2f) | File import (2f) |
| C, if decided | Microsoft and Google accounts (2e) | iOS EventKit |

Release A is the useful whole: manual Events everywhere, links on the desktop, every calendar the phone
has on Android, the same busy time on both.

## Verification

- Vectors of contract 20 in both test suites, under three time zones.
- Desktop: unit tests for the ICS reader (series, overrides, zones, all-day, free, cancelled), the harness
  scenario with a local ICS server and real input (Events drawn, repeated, skipped, deleted; links added,
  Busy only, removed), axe and forced colours.
- Android: the same vectors, the `vicu-android` harness on an emulator with a local calendar account.
- Privacy checks: no link, password or token in a log line, config.json, the synced carrier or IndexedDB;
  Busy only titles absent from the disk cache.

## Open decisions

1. The section number (20) and whether design tokens get an Events colour role instead of a fixed hex.
2. Whether 2e is built at all, decided after release A.
3. A device-only switch per Event (default synced), if work Events should stay off the Vikunja server.
4. Whether the import (2f) belongs in release B or waits for a request.
