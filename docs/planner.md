# The planner

Give tasks a time on a timeline, and plan a day from what you have. It is off until you turn it on in
Settings, Pro, Plan, per device (it works whether Pro is on or off). The times you set show on every device either way, because they
are the task's own start and end dates.

## Time blocks

A block says when you mean to do a task. It sits on top of the due date: the due date says which day
a task belongs to and when it is due, the block says what time is set aside for it. A task without a
block is a complete task, and nothing moves on its own.

You can make one anywhere you type a task: `Call Sam tomorrow at 3pm for 30m`.

- A task with a block today is on Today, even when it is due later.
- A row shows the block ("15:00–15:30"). A date-only due date on the same day is left out, because
  the block already says that day.
- Change the due date and a block on that day moves with it. Clear the date and the time goes too.

## The Plan screen

- **Day, 3 days, Week.** Tasks due on a day without a time sit in a row above that day's timeline, in
  every view. In Day view the row shows only when the day has some, and while you drag a block it
  appears as "Drop here to remove the time". In 3 days and Week a day header selects that day. Week
  starts on Monday.
- **The list on the left.** Chips pick where the tasks come from: the selected day without a time
  ("Today"), Inbox, Next 7 days and No date, each with its count, or Project, which searches every
  project. A list that has not been loaded yet shows no count. The box below them filters by title.
- **Drop a task on a time.** It takes the default length (the gear; 30 minutes to start, synced to
  your other devices). A due date before that time moves to that day, and the message says so, with
  Undo; a later one stays as a deadline.
- **Drag an edge** to change the start or the end, in 15-minute steps. **Click a block** for exact
  lengths and nudges, and for its day: Today, Tomorrow, the next few days or Pick a date move it to the
  same times on that day, with Undo, and the view goes to that day. Past days cannot be picked.
- **In Day view, drag onto Back or Forward** and hold there for half a second to turn to the day
  before or after; keep holding to go on. The drag carries on, so you can drop the block or the task
  on a time of the new day. Back stops at today.
- **Drag on an empty time** to add a task, into the project you are browsing or the Inbox. **Ctrl+N**
  (Cmd+N on a Mac) does the same at the selected day's next free time. With no free time left on that
  day, it opens the Inbox's new task field.
- **Drag a block back on the list** to remove its time. The date stays.
- **Keyboard:** Alt+Shift+Up or Down moves a focused block 15 minutes, Shift+Up or Down changes its
  length, Enter opens the lengths.
- **Fit today** (the gear) gives the tasks without a time the next free slots, most urgent first, with
  Undo. Free time is your work hours (the gear; 08:00 to 18:00 to start) less what is planned.

Routines show as small pills at their times. They have no length and never count as busy. Turn them
off in the gear.

## Plan my day

Four steps, today or tomorrow. It works fully without the assistant.

1. **Leftovers.** Unfinished tasks from before: Today, Tomorrow, No date or Done, one at a time, or skip
   them. Each is written at once.
2. **Choose.** Tick what you will do, from the day, the Inbox, what is coming up or any project. A meter
   compares it with your free time. Click a length to change it.
3. **Arrange.** The dashed blocks are a draft in your free slots, and nothing is saved yet. Drag them,
   stretch them, or keep a task without a time. Accept the plan writes it.
4. **Ready.** A summary of the day. Undo all puts back everything the session changed. Remind me when
   each block starts writes a reminder on each block. Ask me to plan tomorrow sends one notification
   each evening at the time you set.

## With the assistant

With Ask set up (Settings, Assistant), a switch in the session adds suggestions, each dashed with a
short reason. Nothing is saved until you tap.

- **Leftovers:** one of the four for each, with Apply the suggestions.
- **Choose:** how long each task takes, tasks worth adding, and what can wait when you are over.
- **Arrange:** an order with start times, long work in long gaps and quick tasks in short ones. First
  free slots is one tap away.

It sends one request when the session opens, on Ask's model, and another when you change the day or
press Ask again: each task's title, project, priority, due date, subtask count and the start of its
notes, your free time and your routines' times, without their names. If the request fails it says so
once and the session carries on with first free slots and your default length.

The contract is `docs/cross-app-semantics-v1.md` sections 14.10 and 16, and
`docs/ai-assistant-v1.md` section 10.
