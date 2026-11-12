# Vicu Pro

Pro is an optional set of tools for people who lead work with others: what you can do right now,
what people promised you and what you promised them, the initiatives you are steering, and faster
ways to work through a lot of tasks. It is free and built into Vicu. Everything it stores lives on
your own Vikunja server, next to your tasks.

Pro only adds. With Pro off, Vicu looks and behaves exactly as it did, and turning Pro off writes
nothing: what Pro stored stays on your server, untouched, until you turn it on again. Another device
or the Vikunja web app keeps Pro's data safe even where Pro is off.

## Turning it on

Settings, Pro. Turn on **Pro**, then choose the parts you want. Each part works on its own:

| Part | What it adds |
|---|---|
| **Know what you can do now** | Available, Remaining and All on your lists; start dates; "After" (wait for another task); sequential projects; projects and labels on hold; flags; Focus |
| **Keep track of promises** | People, promises both ways, verdicts, Waiting on, the person page, recaps, import from Copilot |
| **Steer the portfolio** | Initiatives with a cap, ranking and parking; readiness; escalations; the Sponsor desk; request triage; meetings |
| **Work fast, look back** | Pro conditions and grouping in custom lists, the table, the inspector, estimates in Plan my day, the daily focus block, the weekly execution review, the quarterly impact |

**Pro's assistant** (off by default) lets the assistant see Pro's data: Ask gets tools for
promises, people and the portfolio, the import can convert plain notes, and a meeting card can
draft promises from what was said. With it off, the assistant sees your tasks as before and none
of Pro's data.

## Know what you can do now

- **Available, Remaining, All.** Lists show what you can act on now. A task is not available while
  it starts later, waits on another task ("After"), is not the next step of a sequential project, or
  sits in a project or under a label on hold. The row says why, and a line at the end says how many
  are hidden, with Show.
- **Start dates.** Type `starts monday` in quick add, or use Start on an open task. A task with a
  start date is hidden from Available until that day. A time block is its own start.
- **After.** On an open task, After picks the tasks it waits on.
- **Project type and status.** In a project's menu: Parallel, Sequential (only the first open task
  is available) or Single actions; Active or On hold.
- **Flags.** `!flag` in quick add, Mod+Shift+F on a row, or the flag on an open task. Flagged lists
  them all.
- **Estimates.** `~30m` or `~1h30` in quick add, or Estimate on an open task.
- **Focus** (Mod+Shift+O). Shows one area of your projects everywhere until you leave it.
- **Repeat rules.** A repeating task can end after a number of times or on a date.

## Keep track of promises

- **People.** Right-click a label in the sidebar and choose This is a person. A person can have
  other names they go by.
- **Capture.** `Jan: send the deck friday` is Jan's promise to you; `for Jan: review the budget`
  is your promise to Jan. On a promise, the row shows the person instead of a checkbox, because it is
  not yours to tick.
- **Verdicts.** When a promise is due, give it a verdict: Delivered, Late, Not yet (with a new
  date), Renegotiated, Dropped, or Taken over. Keys 1 to 6 on the row. Promises due today are at the
  top of Today. Undo works on every verdict.
- **Waiting on** lists what others owe you, by person.
- **The person page** has their open promises both ways, how the last 90 days went in plain words
  (never a score), and a 1:1 agenda you can copy.
- **Recap.** Copy what was agreed as text for mail or chat; the promises in it are marked as sent.
- **Import** (Mod+Shift+M, or paste anywhere in a list or in Quick Entry). Copy the Copilot prompt
  from a person, an initiative or a meeting, run it in Microsoft 365 Copilot or another assistant on
  your meeting notes or a mail thread, and paste its answer. Vicu shows every item with what it
  will do; nothing is added until you choose Add. Mod+Shift+I stays the developer tools.

## Steer the portfolio

- **Initiatives.** In a project's menu, Initiative, Start. The portfolio has a cap (four unless you
  agree on another), a rank you change with the arrows, and Park with a reason. A parked
  initiative's tasks leave Today and Upcoming until you start it again.
- **Readiness.** An initiative's panel (on its project page) has nine items: sponsor, owner, why,
  what done looks like, the smallest next result, what you are not doing, who decides, capacity
  agreed, and when to stop. Adding a task to an initiative that is not
  ready asks first ("Log anyway") and counts it.
- **Escalations.** A promise missed twice drafts an escalation for the sponsor. Put it on the agenda,
  copy it, resolve it with what was decided, or dismiss it.
- **Sponsor desk.** Escalations, decisions you are owed, initiatives without agreed capacity, and the
  one-pager to copy or print.
- **Requests.** `req:` in quick add, or Treat as request on a row, opens triage next to the ranked
  portfolio: Accept into an initiative, Delegate, Decline (logged), or Ask the sponsor. The reply to
  send back is copied.
- **Meetings.** On People, New meeting: a name, the people in their order and a rhythm. Start round
  goes through the people one card at a time, in any order and without a timer (Enter next, S skip,
  A absent); verdicts and new promises are written as they happen. End meeting writes the round and
  opens its recap.

## Work fast, look back

- **Pro lists.** The list editor has a Pro section: Show (Available now, Remaining), Flagged,
  Estimate at most, Project status, Promise, People, Group by and Rows show, with a live count of
  the open tasks that match. On a new list, Start from offers Next actions, Waiting on, Quick wins
  and Flagged by project. These conditions are kept and read by every device, Pro on or off.
- **Table.** A list can show as a table (Rows or Table at the top): click a column to sort, Shift and
  click for a second key. Rows select like list rows.
- **Inspector** (Mod+I with two or more tasks selected, or Inspector in the selection bar): set the
  start date, the estimate and the flag of all of them at once.
- **Plan my day** uses estimates as lengths and proposes a **focus block** first: 60 to 90 minutes
  for the tasks that move your top initiatives.
- **Weekly review.** Before the usual steps: give verdicts, send what was agreed, escalations and
  decisions, check the portfolio, note the value delivered; and the mirror, a line about your last
  seven days.
- **Quarterly impact** (on Portfolio): the value delivered, initiatives closed, decisions and
  promises of this or the last quarter, with a line about your own growth. Copy or print.

## Links

`vicu://` links open a task, a view or Quick Entry from other apps and scripts: `vicu://task/123`,
`vicu://view/flagged`, `vicu://view/waiting`, `vicu://add?title=...&project=...&due=...` (fills
Quick Entry in, never creates on its own). Links work in the installed app.

## Where Pro's data lives

Pro keeps its records (promises and verdicts, initiatives, logs, meetings, estimates and its
settings) in one hidden task in your Inbox, titled "Vicu Pro ledger (sync metadata — do not
delete)", like Vicu's other synced data. Older records move to hidden archive tasks. Start dates,
flags, labels and task relations are Vikunja's own fields, so the web app shows them too.

Work data on a personal server, and the assistant's provider, may fall under your employer's
policy. Check it before you use Pro for work.
