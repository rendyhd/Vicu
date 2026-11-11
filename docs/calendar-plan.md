# Events and calendars on the Plan screen: plan

Status: 12 November 2026, built on both apps (desktop branch `feat/calendar-poc`, mobile branch
`feat/calendar-events`), not released. The table below is the final state; each phase says more.
Background research: `reports/Calendar sync for Plan screen.md` (not committed).

## Status

| Part | Desktop | Android | iOS (vicu-android) | Verified | Not verified |
|---|---|---|---|---|---|
| Contract 20 and its vectors (`planEvents`, `eventBusy`, `eventChanges`, `icsImport`) | yes | yes | yes (common code) | both suites; desktop under Auckland and New York; Android JVM and iOS simulator | |
| Phase 1: Events (make, change, repeat, skip, Undo, timeline gestures, Plan my day busy time) | yes | yes | yes | harness `plan-events` (desktop light and dark), `plan-events.mjs` on the emulator | iOS by hand on a device |
| 2a. Calendar links | yes | no (2b covers it) | no | unit tests, harness `calendar-poc` and `calendar-sources` | |
| 2b. Device calendars | - | yes (`CalendarContract`) | yes (EventKit) | Android harness with a local calendar account; iOS simulator tests | iOS permission prompt and reads on a device |
| 2c. CalDAV accounts | yes | no (DAVx5 through 2b) | no | fake CalDAV server tests, local Radicale (harness `calendar-sources`) | real iCloud, Fastmail, Nextcloud |
| 2d. Mac calendars (EventKit) | yes (macOS only) | - | - | unit tests with a fake helper | the permission prompt and reads on a signed, notarized build |
| 2e. Microsoft 365 and Google | yes, without registered OAuth clients | no (desktop only) | no | fake provider (unit tests, harness `calendar-accounts`) | real accounts; registering the clients (`calendar-oauth-setup.md`) |
| 2f. Import a calendar file | yes | yes | yes | `icsImport` vectors, harness `calendar-import` (desktop) and the emulator | |

Settled in the final integration (contract 20, both repos): the repeat choices of a change are those of
the day the changed rule starts on (20.6, vectors `choiceDays`); an event you declined is left out and one
you have not answered is tentative wherever the source tells your answer (20.9); Microsoft's "working
elsewhere" is free (20.9); a calendar shared as free/busy only shows "Busy" or "Free" (20.8: Google's
free/busy access and Android's free/busy access level now do).

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

Done since, desktop (branch `feat/calendar-poc`):

- **Plan my day** counts Events and calendar events as busy (`planMeter`, `draftBlocks` take `eventBusy`;
  `use-plan-busy.ts` is the one source for the Plan views and Plan my day; the assistant gets the
  reduced free time, never titles). Plan my day's timeline draws the events.
- **Move and resize your own Events on the timeline** with the block gestures; a repeating one asks
  This time only, This and following or All times when it is let go (Escape cancels).
- The popover: a **Change** selector at its top (This time, This and following, All times; All times by
  default) for a repeating Event, **Ends on** (Never or a date, sets `until`).
- **New event without drawing**: the palette's "New event" and Ctrl+Shift+N on Plan; the title box reads
  `Manager call every Tue 10:00 for 30m` (`lib/event-quick-add.ts` over the quick-add parser).
- Keyboard: Enter opens an event, Alt+Shift+Up/Down moves your own Event, Shift+Up/Down its length.
- Harness: scenario `plan-events` (id EVT, axe and forced colours); `calendar-poc` (CAL) keeps the
  calendar links.

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

Done since, desktop (branch `feat/calendar-poc`):

- A source structure (`src/main/calendar/sources/types.ts`): every kind (link, CalDAV, and later EventKit,
  Microsoft, Google) implements connect, list calendars, read a range, describe; the service keeps what is
  shared. One store for all connections (`calendar-feeds.json` version 2, the proof of concept's version 1
  read), a connection holding one or more calendars with their own choices.
- The last good copy on disk per calendar (`userData/calendar-cache/`), reduced to the fields Vicu reads
  (no title or place for Busy only) and encrypted with safeStorage like the links; offline start, and a
  failing calendar keeps its events with "Not updated since" and the reason.
- Conditional requests (`ETag`, `If-Modified-Since`, and the same file again by its hash); read again on
  window focus (the 5-minute rule) and at once on F5, Mod+R and the palette's Refresh.
- Rename and colour per calendar, plain error sentences per calendar, 15 MB per read and 2000 events per
  calendar per range.
- `VFREEBUSY` periods as events titled "Busy" (FBTYPE=FREE left out, BUSY-TENTATIVE tentative).
- TZIDs without a `VTIMEZONE`: Windows names (and Outlook display names) mapped to IANA, a zone built from
  the system's zone data.
- `src/main/safe-storage.ts`: the asynchronous safeStorage calls when present (Electron 45), the older ones
  otherwise, used by the calendar store. Still to do before upgrading past 45: the AI key store and the
  sign-in token store, whose callers are synchronous. On Linux without a keyring Settings says links and
  passwords are only obscured.
- Add calendar dialog with help per provider (Google, Outlook, iCloud, Proton) and the work-calendar note;
  the Plan gear shows a summary and Manage.
- Harness scenario `calendar-sources` (CALS).

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

Done (desktop, branch `feat/calendar-poc`): `src/main/calendar/sources/caldav.ts`. Presets iCloud, Fastmail,
Nextcloud (the typed address plus `/remote.php/dav`) and Other, user name and app password with the
provider's link; discovery through `/.well-known/caldav`, the principal and calendar-home-set; only VEVENT
calendars are offered and the user picks which to show (nothing is saved before). Reads are a time-range
calendar-query for a window around the days on screen (ETags only), a calendar-multiget for new and
changed events, and nothing more while the ctag or sync token is unchanged (`sync-collection` is not
used: the ETag diff of the window does the same with one REPORT every server has). The password is
sealed with the rest of the account's config, sent only to the account's own site, never to a window.
Tested against a fake server in unit tests and a local Radicale (`scripts/ui-verify/radicale.mjs`, unit
test `calendar-caldav-live.test.ts`, harness `calendar-sources`). Not yet tried against iCloud, Fastmail
or Nextcloud themselves.

### 2d. macOS calendars through EventKit, desktop

Everything added in macOS Settings (iCloud, Google, Exchange, CalDAV) without a sign-in in Vicu. A Swift
helper like `native/voice-macos`; calendar usage strings and the calendars entitlement on the app.
Gate: a signed, notarized build must show the permission prompt as Vicu's and read events.

Built: `native/calendar-macos/` (read-only helper: status, request, calendars, events, watch), `npm run
calendar:helper` into `resources/calendar/`, the kind `eventkit` (`src/main/calendar/sources/eventkit.ts`,
"Mac calendars" in the add dialog on macOS only). Each occurrence becomes one small iCalendar document, so
Busy only and the last good copy work as for the other kinds; a change on the Mac reads the shown Mac
calendars again at once. Seen on macOS 27: TCC names the app that starts the helper as responsible and
refuses to ask when that app's Info.plist lacks the usage string, which is why a development run on
Electron.app gets no prompt. Still open: the gate above (a signed build, a person to answer the prompt).

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

Built (desktop, branch `feat/calendar-poc`), waiting for registered clients: `src/main/calendar/oauth.ts`
(the browser sign-in: authorization code with PKCE S256 and a random state, back to the loopback listener
on a free port, `http://localhost` for Microsoft, `http://127.0.0.1` for Google; token requests, refresh,
Microsoft's rotating refresh tokens kept; errors as sentences), `sources/oauth-account.ts` (what both
share: the sealed config with client and tokens, the window read around the days on screen as for CalDAV,
each occurrence made into an iCalendar document so the reader, Busy only and the last good copy are the
same as for every kind), `sources/microsoft.ts` (Graph `/me/calendars` and `calendarView` in UTC, paged)
and `sources/google.ts` (`calendarList`, `events.list` with `singleEvents`, paged). Free and "working
elsewhere" are not busy, tentative is tentative, cancelled and declined events are left out (Google:
working-location entries too). Polling is the window read with a hash of the events, not sync tokens.
Errors: AADSTS65001, `consent_required`, `interaction_required` and the admin-only codes say "Your
organisation needs to approve Vicu" with a link to `docs/calendar-it-admins.md`; `invalid_grant` and a
401 say "Sign in again", which the account offers in Settings (same account checked). Removing a Google
account revokes its token. The client ids are in one place, `src/main/calendar/oauth-clients.ts`, empty
until registered (`docs/calendar-oauth-setup.md`); meanwhile the dialog offers "Use my own client"
(client id, and for Google its secret), sealed per device in `calendar-oauth-clients.json`. Tested
against a local fake provider (`scripts/ui-verify/fake-calendar-oauth.mjs`): unit test
`calendar-oauth.test.ts`, harness `calendar-accounts` (CALA), with `VICU_TEST_CALENDAR_ENDPOINTS` read
only by an unpackaged build. Not yet tried against Microsoft or Google themselves.

### 2f. Import a calendar file into Events (one time)

For a yearly schedule, school terms, public holidays, or a work schedule where policy allows exporting it.

- Open an `.ics` file; a preview lists what becomes Events: a series whose rule fits the repeat rule
  becomes one repeating Event, anything else becomes single Events for the next 12 months; "Busy only"
  drops titles at import.
- After import they are ordinary Events (synced, changeable); nothing stays linked to the file.

Done (desktop, branch `feat/calendar-poc`): "Import calendar file..." in the Plan gear and in Settings,
Plan, Events. Main opens the file dialog and reads the file (`calendar:import-file`, 5 MB at most) with
`importIcsText` (contract 20.10) for today, with and without Busy only; the window shows the preview
(`ImportCalendarFile.tsx`: counts of repeating and single Events, the titles, Busy only, the note that
they become ordinary synced Events) and Import writes every `event.<id>` in one synced change with one
Undo toast. At most 500 Events per import (`MAX_IMPORT_EVENTS`), a larger file is refused with a
sentence. Harness `calendar-import` (IMP).

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

Final run, 11 and 12 November 2026 (after merging `feat/calendar-eventkit` and the contract changes above):

| Check | Result |
|---|---|
| Desktop `npm run verify` | typecheck clean; 298 test files, 6336 tests passed (6 skipped); build ok |
| Desktop tests under `TZ=America/New_York` | all passed |
| Desktop tests under `TZ=Pacific/Auckland` | one failure, `print-template.test.ts` ("renders due and start dates"), which fails on `main` too |
| Harness `plan-events` (light, dark), `calendar-poc`, `calendar-sources` (Radicale), `calendar-accounts`, `calendar-import`, `plan-screen`, `plan-my-day`, `plan-new-task`, `baseline` | all passed |
| Android `./gradlew test lint assembleDebug :shared:compileCommonMainKotlinMetadata` | passed; lint 0 errors |
| `:shared:iosSimulatorArm64Test` on the Mac | passed |
| Android harness `plan-events.mjs` on the emulator | all passed |

Not verified: Mac calendars on a signed, notarized build (the permission prompt as Vicu's and real reads);
Microsoft 365 and Google against the real services (no registered clients yet); CalDAV against iCloud,
Fastmail and Nextcloud; iOS device calendars on a phone; the Android harnesses `plan.mjs` and
`plan-my-day.mjs` in this final run.

## Open decisions

1. The section number (20) and whether design tokens get an Events colour role instead of a fixed hex.
2. Whether 2e is built at all, decided after release A.
3. A device-only switch per Event (default synced), if work Events should stay off the Vikunja server.
4. Whether the import (2f) belongs in release B or waits for a request.
