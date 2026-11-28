# Pro for strategy execution, step 1: the weekly loop

Source: the handoff "Vicu Pro for strategy execution", revision 2 (19 Nov 2026), reviewed on
20 Nov 2026. This plan covers the first of three steps: groups and their action lists, sessions,
the follow-up list, and the text copied into Microsoft 365. It delivers journeys 1, 2, 3 and 6 of
the handoff. Both repos: `vicu` (desktop and web) and `vicu-android` (Android and iOS).

Not in this step: 90-day plans and check-ins (F4, F5), blockers, commitments and stops (F12 to
F14), line of sight (F11), MOR and QBR sessions, countermeasures (F7), 1:1 topics (F10) and system
health (F16). Section 12 says what this step leaves ready for them.

---

## 1. Ground rules

The Pro rules O1 to O5 of `2026-11-11-vicu-pro.md` hold unchanged. On top of them:

| Rule | What it means in code |
|---|---|
| **Additive records** | Every new field is optional on an existing ledger record. No collection is renamed or migrated. A version without this step still reads every record, and shows more, never less. |
| **Works on the web** | Every new handler goes into `registerPortableHandlers`; no Electron, Node, `process` or `Buffer`. Nothing in this step needs the assistant, a connected calendar or the offline queue. |
| **Status is never computed** | Counts and events only. No score, percentage badge or colour for a person or a group. |
| **Text for other people is translated text** | Every word Vicu writes for colleagues comes from the catalogs and is written in a language you choose, separate from the language the app is shown in. English is the source and the only language this step ships. |
| **Copy marks as sent, with Undo** | Copying a recap, message or note writes the mark and shows a toast with Undo, which removes it. |
| **Contract first, both repos** | As before: doc and vectors first, byte-identical, three time zones. |

---

## 2. Decisions

| # | Decision | Source |
|---|---|---|
| 1 | One concept for a leadership team and a small team: a **group**. A large recurring meeting ("forum") is a session of a group. What differs between groups is which sessions they have, nothing else. | Rendy, 20 Nov |
| 2 | A group is today's Pro meeting plus a label. Existing meetings keep working and can be given a label to become a group. | Proposed |
| 3 | An owner promises to a **requester**: the group, another person, a named party as free text, or you. You track all of them. | Handoff |
| 4 | The requester lives in the ledger only. The task carries the owner's label and the group's label, never a second person label. | Proposed |
| 5 | Decisions, open questions and issues are one kind of record with a `kind`. Blockers, commitments, stops and countermeasures join it in later steps. | Proposed |
| 6 | What happened "since the last session" is worked out from the session's dates and from verdict and task times. A session record stores no lists of tasks. | Proposed |
| 7 | The follow-up list starts with five kinds of line: verdict due, check before due, bring-back date, recap not copied, weekly note. | Proposed |
| 8 | Checks before due cover every dated action of a group, one line per person, 2 working days ahead. Working days are Monday to Friday; public holidays are not known. | Proposed |
| 9 | Generated text goes through the translation catalogs. The language is selectable per group, with an account default; English first, others by translators. | Rendy, 20 Nov |
| 10 | Used on the installed app and on the web version alike. | Rendy, 20 Nov |
| 11 | Phone in this step: the follow-up list with verdicts and sharing a message, a read-only group page, and capture with a group. Sessions and generated documents other than the check message stay on desktop and web. | Proposed |
| 12 | "No limit" for the initiative cap. | Handoff |

Name in the UI: "Group". It is one catalog string, so it can still change.

---

## 3. Measure first (M0)

Two things are not known and decide details below. Both are measured against the local test
server before any contract text is written.

1. **Ledger size.** Build a synthetic ledger: two groups, 8 actions a week each for 26 weeks with
   two verdicts on a third of them, 5 sessions a week, 3 decisions and 2 issues a week. Measure
   the JSON against the 384 KiB cap and the 70 percent warning. If it passes 50 percent, closed
   promises of a group archive after 120 days instead of 180 (the reliability line needs four
   sessions, the person pattern 90 days).
2. **Writes during a session.** `pro-ledger-service.ts` has no debounce. Give 10 verdicts in a
   row and count the carrier writes and their time. If each verdict is a full write, add one
   coalescing delay to the service (local copy at once, one server write after the burst).

**Measured on 20 Nov.** A synthetic ledger of two groups at 8 actions a week reached 297 KB after
26 weeks (77 percent of the cap) and 371 KB at 12 actions a week (97 percent). So a group's records
(promises with `to`, log entries with `group`, every round) archive after 90 days, not 120: about
40 percent of the cap at 8 actions a week. Writes need no change: `mutate` starts a sync at once,
and changes made while one is in flight are sent together 250 ms after it ends.

Check-in history (step 2) does not fit the main ledger: about 520 KB for two groups, eight items
and two years. Step 2 adds history parts per quarter. This step adds nothing that needs them.

---

## 4. Data model

### 4.1 Vikunja

- A group's label: an ordinary label, marked by the synced preference `label_kind.<id>` =
  `"group"` (the key that marks a person today).
- An action: an ordinary task with the group's label, the owner's person label and usually a due
  date, in any project.

### 4.2 Ledger (contract 21.7), all additive

| Record | New optional fields |
|---|---|
| `meetings.<id>` | `label` (the group's label id; a meeting with a label is a group), `sessions` (`[{ id, kind, rhythm }]`, kind `weekly` or `standup` in this step; unknown kinds kept), `checks` (`false` turns checks before due off), `language` (BCP 47 tag for copied text) |
| `rounds.<id>` | `kind`, `started` and `ended` (UTC instants), `read_back` (true when done), `score` (1 to 10, never exported), `recap_sent` (instants) |
| `promises.<taskId>` | `to` (`{ group: <labelId> }`, `{ person: <labelId> }` or `{ text: "…" }`; absent means promised to you), `check_on` (date-only), `checked` (instants, a union in the merge like `sent`), `no_check` (true) |
| `log.<id>` | kind `issue`; for every kind `group` (label id), `session` (round id), `rank` (issues), `shared` (instants; decisions) |
| `settings` | `cap_off` (true: no limit), `check_days` (default 2), `workdays` (default `[1,2,3,4,5]`), `note_day` (weekday of the weekly note), `note_sent` (instants), `text_language` (default `en`), `weekly_done` (`{ week, steps }`) |

Rules that follow:

- **Owner and direction.** `dir: "theirs"` with `person` is the owner, as today. `to` says who it
  was promised to. Your own action for a group is `dir: "mine"`, `person: null`,
  `to: { group }`. An older version reads a promise with `to` as promised to you.
- **Membership.** An action is in a group's list while its task carries the group's label. An
  action without a promise record, or with `person` null and `dir` not `mine`, is "No owner".
- **Closed.** An `issue` closes on `resolved`, not on `at`. The archive rule of 21.7 gets this
  line.
- **Merge.** `checked` joins `verdicts` and `sent` as a union. Everything else stays "the newer
  revision wins".
- **Rank changes** stop writing a `decision` to the log (F0.6). They write nothing.

### 4.3 Device config

- `pro_followup_dismissed`: `{ "<line key>": "<until date>" }`, the "dismiss for today" of a
  follow-up line, like `pro_verdict_snooze`.
- Session state while a session is open stays where the round state is today.

---

## 5. Contract changes (M1, both repos, before code)

`docs/cross-app-semantics-v1.md`:

- **5.5 Pro phrases.** A label token whose label is a group gives `group` (the label id) next to
  the label. A second `$` phrase is read when exactly one of the two follows `for`: the plain
  one is the owner and the `for` one the requester (`$Jan pricing proposal for $Priya`). `check
  on <date>` gives `checkOn` and leaves the title, only when the text also has a person; the
  exact words are settled against the corpus.
- **21.5 People.** A person page splits "promised to you" from "promised to others", and groups
  each by group.
- **21.6 Promises.** `to`, `check_on`, `checked`, `no_check`. A second miss of a group's action
  adds an issue to that group.
- **21.7 Ledger.** The fields of 4.2, the `checked` union, the `issue` close rule.
- **21.9 becomes "Groups and sessions".** The group, the two session kinds and their fixed
  agendas, carry-forward, the sections of the group page, the reliability line, read-back, end.
- **21.10 Portfolio.** `cap_off`.
- **New 21.17 Follow-ups.** The five lines, their order, working days, bundling per person, what
  clears a line.
- **New 21.18 Text for other people.** The document model, the keys and their English text, the
  three renderings, the language choice, dates in that language.

Fixtures (`cross-app-semantics-v1.json`, block `pro`): `groups`, `groupPage`, `reliability`,
`sessions`, `workingDays`, `followUps`, `documents`, more cases in `ledgerMerge` and `archive`,
`capOff`. `nlp-corpus-v1.json`: the group token, owner with requester, `check on`. Pro off: the
same texts read as before.

---

## 6. Shared rules (M2): pure modules and Kotlin ports

New in `src/shared/pro/`, each with a Kotlin port in `shared/.../util/pro/`:

| Module | Holds |
|---|---|
| `groups.ts` | A group from a meeting record and its label; members in order; `actionsOf(group, tasks, ledger)`; who an action was promised to; "No owner"; the group page's sections worked out from the last session's `ended` (due since, overdue, new since, done since, yours); the reliability line as counts and one English sentence key |
| `sessions.ts` | The agenda of a kind (weekly: actions with verdicts first, issues, new, read-back; stand-up: actions due this week); carry-forward; what a session held, worked out from `started` and `ended`; the end record |
| `working-days.ts` | `workingDaysBefore(day, n, workdays)`, `isWorkingDay` |
| `follow-ups.ts` | `followUps(world, today, settings, dismissed)`: the ordered lines, each with a stable key and one action |
| `documents.ts` | The document model (headings, lists, paragraphs; each piece a message key with parameters, or literal text for names and titles) and `renderDocument(doc, t, dateFormat)` giving plain text, HTML and Markdown; builders for the session agenda, session recap, read-back, check message and weekly note |

Changed: `ledger.ts` (fields, `checked` union, `cap_off`, issue close), `promises.ts` (`to`,
`check_on`, marks), `people.ts` (the split), `portfolio.ts` (`capState` with no limit),
`import.ts` (an own action without a person becomes your promise to the group; `needs` applied;
an `open_item` with someone to ask also logs the question), `weekly.ts` (steps remembered per
week; the weekly note step), `prefs.ts` (`label_kind` `group`).

The existing recap of 21.8 is rendered through `renderDocument` at the end of M2; its
`pro.recapText` vectors stay as they are and must still pass.

---

## 7. Desktop and web

### 7.1 Groundwork (M3, the F0 items)

- Portfolio settings: "No limit". Then no "at the cap" message and no "choose one to park".
- Initiative on a promise from the promise popover, the meeting card and quick add.
- The import fixes of section 6.
- Weekly review: "Mark done" written to `weekly_done`.
- Tests for `pro-ledger-service.ts`: the sync loop against a fake server, the archive write
  before the tombstones, the id of a task made offline. The merge already has vectors.

### 7.2 Groups (M4)

- **Group dialog** (from a label's menu, the People page and a meeting): mark the label, members
  in order, sessions, checks on or off, language of copied text. "Make this a group" on an
  existing meeting adds the label. Removing the mark leaves label and tasks as they are.
- **Capture.** The composer, the title editor and Quick Entry read the group token and the
  requester (`useTaskParser` passes the groups as it passes people); `lib/pro/capture.ts` writes
  `to`. Chips show "Jan → LT Ops". Suggestions after the label trigger list groups first.
- **Group page** (`views/pro/GroupView.tsx`, route `/pro/group/$labelId`, lazy, listed in
  `code-splitting.test.ts`): actions by owner with verdict keys, the sections, your own actions,
  "No owner", the reliability line, decisions, open questions and issues, past sessions. A slot
  at the top stays empty until blockers exist.
- **Person page:** promised to you and promised to others, each by group.
- **Sidebar:** groups under Pro (`ProNav.tsx`), gated by `usePro().layer('promises')`.

### 7.3 Sessions (M5)

- `MeetingView` becomes the session: started for a group and a kind, steps from `sessions.ts`,
  the same keys as today. Quick Entry and the composer pre-fill the group while a session is
  open.
- Issues: ranked, solved or carried, "make an action" from an issue.
- **Read-back** as the last step: the session's decisions and new actions with owner, requester
  and date, each editable; "Read back done" writes `read_back`.
- **End:** the private score, the round record, then the recap dialog for this group only.
  Copying writes `recap_sent`, the promises' `sent` and the decisions' `shared`.
- A meeting without a label runs as it does today.

### 7.4 Follow-ups (M6)

- `components/pro/FollowUps.tsx` at the top of Today, in place of today's verdict block: the
  lines of `follow-ups.ts`, one action each, keyboard throughout, D dismisses for today.
- A check line opens its message; Copy writes `checked` on every promise in it. A bring-back
  line is cleared the same way or by "Checked".
- `check on` in quick add and a "Check on" date in the promise popover.
- Settings, Pro: days ahead, working days, weekly note day, default language of copied text.

### 7.5 Text for other people (M7)

- Keys under `proText.*` in `locales/en.json`; `renderDocument` gets
  `i18n.getFixedT(language)`, so the text follows the group's language, not the app's.
- Dates in copied text use that language's words (`Intl` with its tag). The contract's date
  section says so; app dates stay as they are.
- One copy path (`lib/pro/export.ts`): `clipboard:write-rich` with HTML and plain text, as
  recaps do today and as the web host already answers; "Copy as Markdown" beside it.
- **Weekly note:** a palette entry and a key on the weekly review; per group delivered, slipped
  with the reason when a verdict has one, decisions, issues carried, next week's due actions.
  Sections for blockers, yes-ifs, stops and status changes are left out until those exist.
- `docs/translating.md` (both repos) gets "Text Vicu writes for other people": what the
  parameters are, that names and titles are never translated, plural forms.

### 7.6 Web

No separate build: every surface above is renderer code over the ledger. To check:
`web-channels.test.ts` (no new channel left unanswered), `portable-closure.test.ts`, and
`scripts/ui-verify/web.mjs` opening a group page, running a session and copying a recap.

---

## 8. Mobile (`vicu-android`, Android and iOS)

- **Foundations first:** the Kotlin ports of section 6 against the same vectors, and the parser
  change. A phone without them must keep every new field when it writes a promise (it does
  today through unknown fields; a test pins it for `to`, `checked` and `check_on`).
- **Follow-ups screen:** the five lines; a verdict through the existing sheet; a check message
  through the share sheet, which writes `checked`; dismiss for today.
- **Group page:** read-only sections and the reliability line; verdicts on its rows.
- **Capture:** the group label and the requester in task entry.
- **Strings:** the `proText` keys in `strings.xml`, so a shared message is in the group's
  language.

One agent at a time in this repo, as before.

---

## 9. Testing

- **Vectors** of section 5 in both repos, three zones.
- **Unit:** the modules of section 6; `pro-ledger-service`; the renderer against the English
  catalog; `i18n:check` and the hardcoded-text ratchet for every new screen.
- **Harness** (throwaway data, Pro off at the end):
  - `pro-groups` (PROG): "Jan, pricing proposal, LT Ops, Friday" in one line lands under Jan on
    the group page, on Jan's page under "promised to others", on Today for a verdict on Friday,
    and the task has both labels on the server.
  - `pro-session` (PROS): two weekly sessions of one group a week apart; the second opens with
    exactly that group's open and newly due actions, and its recap holds only that group.
  - `pro-follow-ups` (PROF): three of one person's actions due inside two working days give one
    line with one message; copying clears it until a verdict is due; Undo brings it back.
  - `pro-weekly-note` (PRON): one key gives a note covering both groups from the week's data.
  - `pro-off-parity` still passes.
- **Mobile harness:** the follow-ups screen and the group page.

---

## 10. Build order

| Step | What | Repos |
|---|---|---|
| M0 | Measure ledger size and session writes | desktop |
| M1 | Contract text and fixtures | both |
| M2 | Shared rules and Kotlin ports | both |
| M3 | Groundwork: no limit, initiative on a promise, import fixes, weekly "done", service tests | desktop |
| M4 | Groups: dialog, capture, group page, person page | desktop, then mobile capture |
| M5 | Sessions: agendas, issues, read-back, recap per group | desktop |
| M6 | Follow-ups: the list, checks, bring-back dates | desktop, then mobile |
| M7 | Text: catalogs, languages, weekly note, translators' guide | both |
| M8 | Mobile screens, web check, harness, `docs/pro.md` and the guide | both |

Each step ends with `npm run verify` and its harness scenarios. Nothing is released from this
plan; `pro` keeps building the rolling pre-release.

---

## 11. Risks

- **Ledger size.** Group actions are the largest growth so far. M0 measures it; the archive age
  is the lever. If two groups cannot fit even at 120 days, promises move to history parts with
  the check-ins in step 2 and this step ships with the warning.
- **An older version archives an open issue** 180 days after it was logged, because it closes
  every log entry on `at`. Only your own devices run Pro, updated together, so the window is
  small; the contract note says so.
- **"Check" at the start of a title** is common. `check on <date>` is read only with a person in
  the text, and the corpus gets the titles that must not match.
- **Text pinned twice.** English is pinned by the vectors and lives in the catalogs. One test
  keeps the two equal, as it does for the completion toast.
- **Two people named the same in two groups** are one person label. The group split on the
  person page is what keeps them apart; there is no person-per-group.

---

## 12. Left ready for the next steps

- The top slot of the group page and of every agenda, for the oldest blocker.
- `log` kinds: the next kinds add fields, not collections.
- `sessions[].kind`: MOR, QBR and joint add agendas, not a new model.
- The follow-up list: a later feature adds a line kind to `follow-ups.ts` and nothing else.
- The document model: the MOR pre-read and the QBR pack are new builders on it.
- Times kept from the start (`started`, `ended`, `shared`, `checked`, `recap_sent`), so the
  system health counts of F16 can be worked out later without new data.

---

## 13. Things only you can do

- Paste a recap and a weekly note into Outlook and Teams at work and check that headings and
  lists survive.
- Run one real weekly session per group and say what the agenda order should be.
- Decide the final name ("Group") and the day of the weekly note.
- Before step 2: a recent MOR pack, to see which objects carry an official status.
