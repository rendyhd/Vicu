---
title: Vicu Pro
nav: What Pro is
description: Vicu Pro is an optional switch in Vicu for more complex work: what you can do now, promises people made you, initiatives you steer, and faster tools.
lead: Vicu stays simple for everyone. Pro is a switch for the times your work is not simple: other people, many projects at once, and promises to keep track of.
---

## In short

- **Pro is optional and free.** It is built into Vicu and off until you turn it on in Settings.
- **It only adds.** With Pro off, Vicu looks and works exactly as it always did. Turning Pro off
  changes nothing and deletes nothing; turn it on again and everything is where you left it.
- **It comes in four parts** that you turn on one by one: Know what you can do now, Promises and
  people, Portfolio, and Power tools.
- **Your data stays on your server**, next to your tasks, like the rest of Vicu.
- **The phone has the first two parts**; the desktop has all four. The phone keeps the other parts'
  data safe and follows it.
- **This is an alpha.** Things will change. Keep your Vikunja server backed up while you try it.

## Why Pro exists

Vicu is built to be calm: a few lists, quick capture, a clear Today. That suits most days. But some
work is more tangled. You lead a team or a project with others. People promise you things in meetings
and you need to know, a week later, whether they happened. Half your tasks cannot start until something
else is done. You steer several initiatives and keep being asked to take on one more.

Putting tools for all of that into everyone's Vicu would make it heavier for the people who never need
them. So they live behind one switch. You decide when your work needs them, and how much of it.

## Who it is for

Pro is for you if several of these sound familiar:

- You lead people, a team or a cross-team project, and depend on what others deliver.
- You run 1:1s or recurring meetings and want each one to start from what was agreed last time.
- You have more ideas and requests than capacity, and want to say no (or "not now") with reasons.
- Your lists are long, and you want to see only what you can actually do right now.
- You like keyboard shortcuts, tables and doing ten things at once.

If none of this is you, you do not need Pro, and Vicu is not less without it.

## The four parts

Each part works on its own. Start with one and add more when you feel the need.

| Part | What it adds | Complexity | Where |
|---|---|---|---|
| [Know what you can do now](guide:pro/available) | Available, Remaining and All on your lists; start dates; waiting on other tasks; step-by-step projects; on hold; flags; estimates; Focus | Low: a few new fields and a filter | {desktop} {phone} |
| [Promises and people](guide:pro/promises) | People, promises both ways, verdicts, Waiting on, the person page, 1:1 agendas, recaps, meetings, import from Copilot | Medium: a habit of giving verdicts | {desktop} {phone} (meetings and import on the desktop) |
| [Portfolio](guide:pro/portfolio) | Initiatives with a cap, rank and parking; readiness; escalations; the Sponsor desk; request triage | High: a way of running your work | {desktop} |
| [Power tools](guide:pro/power) | Pro conditions and grouping in custom lists, a table view, the inspector, estimates and a focus block in Plan my day, the weekly execution review, a quarterly impact summary | Medium: power tools | {desktop} |

**Assistant help in Pro** is a separate switch, off by default. With it on, the [assistant](guide:assistant) can
see Pro's data: Ask can look up promises, people and the portfolio, an import can convert plain notes,
and a meeting can draft promises from what was said. With it off, the assistant sees your tasks as before
and none of Pro's records.

## Plan and calendars

The [Plan screen](guide:plan) and [Events and calendars](guide:calendars) are listed here too, and their
settings are in **Settings, Pro, Plan** on the desktop (on the phone, right after Pro in **Settings,
General**). They do not need Pro: Plan works the same with Pro on or off. With **Power tools** on, Plan
my day also uses your estimates and proposes a focus block.

## Turn Pro on

:::steps
1. Open **Settings, Pro** on the desktop, or **Settings, General, Pro** on the phone.
2. Turn on **Turn on Pro on this device**.
3. Choose the parts you want. Every part is on until you turn it off.
4. Optional: turn on **Assistant help in Pro** if you use the assistant and want it to see Pro's data.
5. Optional: under **Work area**, tick the project categories that are your work, so promises count only
   there. With none ticked, every project counts.
:::

Pro is per device: turn it on on each device where you want it. What Pro stores is shared through your
server, so a promise you note on the desktop is on your phone too.

Under **Start dates**, Vicu tells you how many of your open tasks already have a start date (set in the
Vikunja web app, for example). With Pro on, those tasks wait until that day; **Show them** lists them.
Pro does not work in standalone mode: it needs a Vikunja server.

> [!TIP]
> A good way in: turn on only **Know what you can do now** for a week. If seeing just what you can do
> helps, add **Promises and people** next.

## Try it safely

- **Turning Pro off writes nothing.** Lists show everything again, the Pro screens leave the sidebar,
  and your Pro data waits on the server.
- **Other devices keep your Pro data safe**, also where Pro is off, also an older Vicu, and also the
  Vikunja web app: Pro uses Vikunja's own fields where they exist (start dates, the favorite flag,
  labels, task relations) and keeps the rest in one hidden task.
- **Back up your server.** Pro is an alpha; a backup of your Vikunja database is the safety net for any
  alpha software.
- **Work data and your employer.** Using Pro for work puts work information on your own server, and,
  with Assistant help in Pro on, in requests to the AI provider you chose. Check that your employer is fine
  with both.

## Pro on the phone

The phone app has **Know what you can do now** and **Promises and people**: the view switch and
reasons on every list, Pro's fields in the task editor, Flagged, Waiting on, People and the person page,
promises due on Today with verdicts, and capture of promise words.

Meetings, import, the Portfolio and the Power tools are on the desktop. The phone still honors their
data: a parked initiative's tasks stay out of the way, and a custom list's Pro conditions work there too.

## Where Pro keeps its data

Most of what Pro adds is stored in Vikunja's own fields, so other apps see it:

- **Start dates** are the task's start date.
- **Flags** are Vikunja's favorite star.
- **People** are labels you marked as a person.
- **"After"** is a Vikunja task relation (blocked by).

The rest (promises and their verdicts, initiatives, logs, meetings, estimates and Pro's settings) lives
in one hidden task in your Inbox, titled "Vicu Pro ledger (sync metadata — do not delete)". Vicu hides
it everywhere. Do not delete it in the Vikunja web app: that would delete those records. Older records
move into hidden archive tasks so it stays small.

## Links into Vicu {desktop}

Other apps, mail rules and scripts can open Vicu with a `vicu://` link:

| Link | Opens |
|---|---|
| `vicu://task/123` | Task 123 in the main window |
| `vicu://view/flagged` | A list: `inbox`, `today`, `upcoming`, `anytime`, `logbook`, `plan`, `review`, `routines`, `flagged`, `waiting` |
| `vicu://add?title=...&project=...&due=...` | Quick Entry filled in; it never adds a task on its own |

Links work in the installed app. The Pro lists (`flagged`, `waiting`) open only while Pro is on.

## Related

- [Know what you can do now](guide:pro/available)
- [Promises and people](guide:pro/promises)
- [Portfolio](guide:pro/portfolio)
- [Power tools](guide:pro/power)
- [Keyboard shortcuts](guide:shortcuts)
