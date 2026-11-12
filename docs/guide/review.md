---
title: Review and guided organizing
nav: Review and organizing
description: Keep projects current with project review, sort the Inbox and overdue tasks one decision at a time, and run a weekly review.
lead: It is hard to decide about tasks you have forgotten. Review and guided organizing show you one task or one project at a time, so deciding is quick.
---

## In short

- **Project review** brings each project back on a schedule you set. You look at it, then choose **Mark reviewed**.
- **Guided organizing** walks you through tasks one decision at a time: the Inbox, overdue tasks, tasks that have waited a long time, and projects due for review.
- **The weekly review** is a checklist in the usual order: Inbox, what is on your mind, last week, overdue, next two weeks, projects, long-waiting tasks.
- **You decide everything.** Sessions work without the assistant. With the assistant set up, it suggests a choice for each card, and you still decide.
- **Undo all** at the end of a session puts back what it changed. It never brings back a deleted task.

## Project review {all}

Project review makes sure no project goes stale. Each project has a review cadence, and Vicu tells you when one is due.

### Open the Review list

Open **Review** from the sidebar or drawer. It has two tabs: **Due**, the projects whose review time has come, and **All tracked**. A project that was never reviewed is "Not reviewed yet". A due project shows as due.

On the desktop, click a project to look at its tasks in place, and press <kbd>R</kbd> to mark it reviewed. **Start review** at the top begins the guided project review below. On the phone, use **Mark reviewed** on a project's row.

### Mark a project reviewed

- **Desktop:** the project's menu, **Review**, **Mark reviewed**, or <kbd>R</kbd> in the Review list.
- **Phone:** **Mark reviewed** on the project's row in Review, or in the project's menu. It has Undo.

Vicu records the review as a short line at the end of the project's description (it starts with "Vicu review" and holds the date and cadence). The description is part of the project in Vikunja, so the web app and your other devices see the same status. Leave that line alone.

### Set the cadence

The default is every 14 days. Change it for one project:

On the desktop, open the project's menu, then **Review**, then **Review cadence**. On the phone the default cadence is set under **Settings, Projects, Review**.

On the desktop, leave a project out with **Exclude from review** and put it back with **Include in review**. On the phone, an **Excluded from review** list in **Settings, Projects, Review** lets you include a project again.

### Review settings {desktop}

**Settings, Projects, Review** has:

- **Enable project review tracking**
- **Default review cadence (days)**
- **Exclude Inbox from review list**
- The list of excluded projects, each with **Include again**

The phone has review settings in the same place, **Settings, Projects, Review**.

## Guided organizing {all}

A guided session shows one card at a time with how far along you are, such as "4 of 14". The tasks are picked when the session starts. A task finished or deleted elsewhere is passed over. Tasks in archived projects, and in projects shared with you for viewing only, never come up.

### The four sessions

| Session | What it shows | Start it from |
|---|---|---|
| **Sort the Inbox** | Every open task in the Inbox, in the Inbox's order | The Inbox header (desktop) or top bar (phone), the weekly review, Ask |
| **Sort out overdue** | Every open task past its date, oldest first | The command palette (desktop), the weekly review, Ask |
| **Waiting a long time** | Tasks outside the Inbox without a date or repeat that nobody touched for 60 days or more, up to 30 | The command palette (desktop), the weekly review |
| **Review projects** | Each project due for review, one page each | **Start review** in Review, the weekly review, Ask |

On the desktop, press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> (<kbd>Cmd</kbd> on a Mac) and type the session's name.

### A card

A card shows the task's title, project, date and labels, and how long ago it was added. You can:

- Give it a date: **Today**, **Tomorrow**, **This weekend**, **Next week**, a date you pick, or **No date**.
- Move it to another project.
- Change the title on the card.
- **Complete** or **Delete** it. Delete asks first when **Confirm before deleting** is on.
- **Skip** it.

**Next** saves the card's choices together and shows the next card. If you changed nothing, Next is a Skip. **Back** shows the previous card as the task is now. Changes made offline wait in the queue like any other change.

At the end a summary says what happened, for example "Sorted 12: 5 scheduled, 4 moved, 2 completed, 1 deleted". **Undo all** puts back every change, except deletes.

### Keys {desktop}

| Key | Does |
|---|---|
| <kbd>Enter</kbd> | Next |
| <kbd>Left</kbd> | Back |
| <kbd>S</kbd> | Skip |
| <kbd>1</kbd> to <kbd>4</kbd> | Today, Tomorrow, This weekend, Next week |
| <kbd>D</kbd> | Pick a date |
| <kbd>0</kbd> | No date |
| <kbd>P</kbd> | Project |
| <kbd>E</kbd> | Title |
| <kbd>C</kbd> | Complete |
| <kbd>Delete</kbd> | Delete |
| <kbd>Esc</kbd> | Leave the session |

### Review projects session

Each project due for review gets one page:

1. Its name, when it was last reviewed, and a health line such as "7 open · 4 untouched for 30+ days · 1 overdue · last done 6 days ago".
2. **Still working on it?** Keep it, or Archive it. An archived project is not marked reviewed. The Inbox cannot be archived.
3. **Untouched for 30+ days:** tasks nobody changed in a month, oldest first, each with the card choices.
4. **Next step:** the first open task in the project's order, or the one the assistant suggests, with quick dates. Or name a new task and add it to the project.
5. **Mark reviewed** records the review and goes on. **Skip** goes on without it.

On the desktop <kbd>R</kbd> marks reviewed, <kbd>S</kbd> skips and <kbd>A</kbd> archives. A subproject is reviewed as a project of its own. **Undo all** at the end also takes back the reviews, the archives and the tasks you added.

## The weekly review {all}

Open **Review**, then **Weekly review**. On the desktop, "Weekly review" is also in the command palette. It is a checklist:

1. **Sort the Inbox**
2. **Anything on your mind?** Starts a brain dump when smart dictation is set up. Otherwise you add tasks to the Inbox right there.
3. **Look back:** what you finished in the last 7 days
4. **Overdue**
5. **Look ahead:** what is due in the next two weeks
6. **Review projects**, while project review is on
7. **Waiting a long time**

**Next** opens the first step not done yet, and you can open any step. A step is done when its session ends or you choose **Mark done**. A step with nothing in it is done from the start. **Finish** records the day of the review and syncs it, so your other devices know. A week later the assistant offers the weekly review again.

> [!PRO]
> With [Pro](guide:pro/power) on, the weekly review adds steps for verdicts, recap, escalations, the portfolio and the value you delivered.

## With the assistant {all}

When the assistant is set up (see [The assistant](guide:assistant)), each card comes with a suggestion. The choices it would make are filled in with a dashed outline, and its reason is under the title. Change or clear any of it. Nothing is saved until you choose **Next**.

- When it thinks a task is finished or outdated, **Complete** or **Delete** is marked "Suggested". It is never done for you.
- Tasks go to the model 20 at a time, and the next 20 are asked a few cards ahead. You can decide a card before its suggestion arrives.
- If a request fails, the session says so once and goes on without suggestions.
- There is no separate setting. Suggestions use the model you chose for Ask and what you agreed to share for Ask.

What is sent: the names of your projects, labels and places, today's date, and the session's tasks (title, project, dates, labels, priority, when they were added and changed, and the first 500 characters of their notes). Text from shared projects is treated as data, never as instructions.

In Ask, an empty conversation begins with what needs a decision (the Inbox, overdue tasks, projects due for review, the weekly review) and each opens its session.

## Desktop and phone {desktop} {phone}

Both apps use the same rules and pick the same tasks in the same order. Guided sessions arrived on the desktop first. Keys exist on the desktop only. On the phone, use the buttons on each card, and start sessions from the Inbox's top bar, the Review screen or Ask.

## Related

- [Projects](guide:projects)
- [Plan your day](guide:plan)
- [The assistant](guide:assistant)
- [Shortcuts](guide:shortcuts)
