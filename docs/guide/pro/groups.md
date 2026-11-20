---
title: Groups, sessions and follow-ups
nav: Groups and sessions
description: Run the actions of a recurring meeting in Vicu Pro: groups and their action lists, weekly and stand-up sessions, a recap to copy, follow-ups on Today and a weekly note.
lead: Most of a plan is carried out in a few recurring meetings. A group keeps one meeting's actions, issues and decisions together, a session takes you through them, and Follow-ups tells you what needs a move from you in between.
---

## In short

- **A group** is the people who agree actions together: a leadership team, a project team. A task
  with the group's label is one of its **actions**.
- **The group's page** shows every action by owner and by where it stands since the last meeting,
  and a line of plain counts: how many were delivered on time, how many late.
- **A session** is one meeting of the group. It walks through the actions that need a verdict, the
  issues, what is new, and a read-back. Ending it gives you a **recap** to copy. {desktop}
- **Follow-ups** at the top of Today lists what needs a move from you: verdicts due, a check with
  someone before their action is due, a recap you have not sent, the weekly note.
- **Text you copy** (agenda, recap, check message, weekly note) is written for the reader, in the
  language you chose for the group. Paste it into a mail or a chat.

> [!PRO]
> This page is part of [Vicu Pro](guide:pro) and builds on [Promises and people](guide:pro/promises).
> Turn on Pro and the part **Promises and people** in **Settings, Pro**.

## Make a group {desktop}

1. Open **People** and choose **New group**, or choose **New group** under Pro in the sidebar.
2. Give it a name, and choose its label: a new label with that name, or one you already have.
3. Add the people, in the order they report in the meeting.
4. Tick the sessions the group holds: **weekly**, **stand-up**, or both.
5. Choose **Save**.

The group appears under Pro in the sidebar. A meeting you already made can become a group: open it and
choose **Make this a group**.

Two more choices are in the same window. **Check actions before they are due** adds a line to
Follow-ups a few working days before an action's date. **Language of copied text** sets the language
of the agenda, the recap and the check messages for this group.

**No longer a group** takes the mark off. The label and its tasks stay as they are.

## Add an action {desktop} {phone}

An action is a task with the group's label. On the group's page, **New task** adds the label for you.
Anywhere else, add the label yourself.

| You type | You get |
|---|---|
| `$Jan site list friday @leadership` | Jan's action for the group, due Friday |
| `$Jan site list friday for $Priya` | Jan's action, promised to Priya |
| `$Jan site list friday check on wednesday` | The same, and a line in Follow-ups on Wednesday to look at it |
| `Draft the on-call rota @leadership` | An action without an owner yet |

`@leadership` is the label in the default style; in Vikunja style it is `*leadership` (see [Quick add syntax](guide:quick-add)).

An action has one owner. The owner is the person who promised it; **I own this** on an action
without an owner makes it yours. To give it to someone later, open the task and use **Promise**.

Who an action was promised to shows on its row: "From Jan, for Leadership team", "From Jan, for
Priya". You give the verdicts on every action you track, whoever it was promised to.

## Read the group's page {desktop} {phone}

The actions are in parts, and in each part by owner:

- **Overdue since the last session**: due before the last meeting and still open.
- **Due now**: due today or earlier.
- **New since the last session**.
- **Open**: everything else.
- **Yours**: your own actions for the group.
- **Done since the last session**.

Above them is one line such as "Last 4 sessions: 9 of 12 on time, 2 late, 1 open past their date."
It counts what happened and is never a score of a person.

Below the actions are three short lists:

- **Issues**: things to solve, not to do. They are ranked; move one up or down, and tick it when it is
  solved. An action that is missed a second time is added here by itself.
- **Decisions**, with the day and who decided.
- **Open questions**, to tick when they are answered.

## Run a session {desktop}

On the group's page choose **Start weekly** or **Start stand-up**, then **Start session**. Nothing is
timed.

1. **Actions.** The actions that need a verdict come first, by owner. Click the person's mark on a
   row, or press 1 to 5, to say what happened: Delivered, Late, Not yet, New date or Dropped. A
   stand-up shows only what is due this week. Mark who is not here.
2. **Issues** (weekly only). Add issues, rank them, tick the ones you solved, or make an action of one.
3. **New actions and decisions.** Type new actions as people commit to them; add what was decided and
   questions nobody could answer.
4. **Read back.** The decisions and new actions of this session, to read aloud before you close, so
   everyone leaves with the same list. Tick **Read back to the room** when you did. You can give the
   session a score from 1 to 10 for yourself; it is never copied.

**End session** writes the session and opens its recap. **Leave without saving** drops the session;
verdicts and tasks you already added stay.

> [!TIP]
> Before the meeting, **Copy weekly agenda** on the group's page gives you the actions due, the other
> open actions and the open issues as text to send round.

## Send the recap {desktop}

The recap holds this session only: decisions, new actions, what was delivered, what changed, issues
solved, open issues and questions, and who was absent.

1. Check the text. Change **Language** if this one should go out in another language.
2. Choose **Copy** for formatted text (mail, Teams, Word) or **Copy as Markdown**.
3. Paste it where the group reads it.

Copying marks the actions in the recap as sent and the decisions as shared; **Undo** on the message
takes that back. Choose **Later** to do it another time: the recap waits in Follow-ups for two weeks.

## Work through Follow-ups {desktop} {phone}

**Follow-ups** is at the top of Today while something needs you. In order:

- **Verdicts due.** A promise whose date has come: give the verdict on the row.
- **Checks.** A few working days before someone's actions are due, one line per person. **Copy
  message** gives you a short note ("Hi Jan, checking one thing: ...") to paste into a chat, and marks
  the actions as checked.
- **Look at.** A date you set with `check on` or **Check on** in the task's Promise. **Checked** clears it.
- **Recap not copied**, for a session you ended without sending its recap. {desktop}
- **The weekly note is due**, on the day you chose. {desktop}

**Dismiss for today** hides a line until tomorrow, on this device. Follow-ups never sends a
notification.

How many working days before the date a check appears, which days are working days, and the note's
day are in **Settings, Pro, Follow-ups**. A group can turn its checks off, and a single action can:
open it, choose **Promise** and tick **No check before due**.

## Write the weekly note {desktop}

The weekly note is a short status for the people above you: per group, how many actions were
delivered on time and late, each date that slipped and why, what was decided, the open issues, and
what is due next week.

1. Open the command palette and choose **Weekly note**, or choose **Write it** in Follow-ups.
2. Read it, change the language if needed, and choose **Copy** or **Copy as Markdown**.

The next note starts the day after this one was copied. It is a draft for you to edit before you send
it: add the two sentences only you can write.

## Details

- **Where it is stored.** A group is a meeting in Pro's hidden record on your server, with the
  label's id. Sessions, issues and decisions are in the same record. Actions are ordinary tasks with
  the label, so a device or app without Pro still sees them.
- **Older history moves out of the way.** Records of a group older than 90 days move to Pro's
  archive; the counts and the pages read the last sessions.
- **Languages.** The text for other people comes from Vicu's translations. A sentence that is not
  translated yet is written in English. See [translating Vicu](https://github.com/rendyhd/Vicu/blob/main/docs/translating.md).
- **On the phone.** {phone} The phone has **Follow-ups** in the drawer and the group's page (from
  **People**, or a group label's menu), with verdicts. Groups are made on the desktop or the web, and
  sessions, the recap and the weekly note are there too; the phone says so on those lines. A check
  message shared from the phone is written in the language the phone shows Vicu in.
- **Turning Promises and people off** hides groups, sessions and Follow-ups. The labels, the tasks
  and the record stay.

## Related

- [Promises and people](guide:pro/promises)
- [Portfolio](guide:pro/portfolio)
- [Quick add syntax](guide:quick-add)
- [What Pro is](guide:pro)
