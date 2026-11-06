# The planner

Give tasks a time on a timeline, and plan a day from what you have. It is off until you turn it on in
Settings, General, Plan, per device. The times you set show on every device either way, because they
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

- **Day, 3 days, Week.** In 3 days and Week, tasks without a time sit in each day's top row, and a day
  header selects that day. Week starts on Monday.
- **The list on the left.** The selected day without a time, Inbox, Next 7 days, No date, or any
  project. The box below it filters by title.
- **Drop a task on a time.** It takes the default length (the gear; 30 minutes to start, synced to
  your other devices). A due date before that time moves to that day; a later one stays as a deadline.
- **Drag an edge** to change the start or the end, in 15-minute steps. **Click a block** for exact
  lengths and nudges.
- **Drag on an empty time** to add a task, into the project you are browsing or the Inbox.
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
