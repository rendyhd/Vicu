---
title: Know what you can do now
nav: Know what you can do now
description: The first part of Vicu Pro: see only the tasks you can act on, with start dates, tasks that wait on other tasks, step-by-step projects, on hold, flags and Focus.
lead: Long lists hide the next thing you can actually do. This part of Pro shows what is available now and says why the rest has to wait.
---

## In short

- Lists show **Available** by default: the open tasks you can do right now. **Remaining** shows every
  open task, **All** adds the done ones.
- A task waits when it **starts later**, comes **after** another task, is **later in a sequence**, sits
  in a project or under a label **on hold**, or is **someone else's promise**. The row says which.
- **Flags** mark the few tasks that matter most; the **Flagged** list gathers them.
- **Estimates** say how long a task takes, and **Focus** narrows the whole app to one area of work. {desktop}
- Everything here is stored in Vikunja's own fields or synced with your account, so it shows on every
  device where Pro is on.

> [!PRO]
> This page is part of [Vicu Pro](guide:pro). Turn on Pro and the part **Know what you can do now**
> in **Settings, Pro** on the desktop or **Settings, General, Pro** on the phone.

## Available, Remaining and All {desktop} {phone}

With this part on, projects, labels, Anytime, custom lists and Flagged get a switch at the top:

| Choice | Shows |
|---|---|
| **Available** | Open tasks you can do now |
| **Remaining** | Every open task, including the ones that wait |
| **All** | Open and done tasks |

Available is where every list starts. The choice is remembered per list on this device, so a project
can stay on Remaining while the rest show Available.

When Available leaves tasks out, a line at the end of the list says so, for example "3 tasks are not
available yet.", with **Show remaining** to see them.

Today and Upcoming are not filtered this way: they are about dates, and a task you dated for today
shows there.

### Why a task is not available

A task that waits says why in its row:

| Row says | Why it waits | What makes it available |
|---|---|---|
| **Starts** Thursday | It has a start date later than today | That day arriving |
| **After:** Book the venue | It waits on another task (and "and 2 more" when it waits on several) | Those tasks being done |
| **Later in sequence** | Its project is sequential and this is not the first open task | The tasks before it being done |
| **On hold** | Its project, or a project above it, is on hold or parked | The project being made active |
| **Waiting** | One of its labels is on hold | The label being made active |
| **Their promise** | It is a promise someone else made you | Nothing to do: you give it a verdict when it is due |

A task can wait for more than one reason; the row shows the first.

## Start a task later {desktop} {phone}

A start date says "not before this day". Until then the task leaves Available, and on the day itself it
shows on Upcoming and becomes available.

- In the title, type `starts monday`, `starts 12 dec` or `starts in 2 weeks`. See
  [Quick add](guide:quick-add).
- On an open task, use **Start date** and pick **Tomorrow**, **Next week**, **In two weeks** or a day.

A time block counts as its own start: a task planned for Friday at 10:00 waits until Friday. While a
task has a time block, its Start date chip is hidden.

> [!NOTE]
> Start dates are Vikunja's own field. If you set start dates in the Vikunja web app before, those
> tasks start waiting when you turn this part on. **Settings, Pro** tells you how many there are, with
> **Show them** to list them.

## Make a task wait on another {desktop} {phone}

Some tasks cannot start until another one is done: send the invitations after the venue is booked.

1. Open the task that has to wait.
2. Choose **After**.
3. Find the task it waits on and pick it. Add more if it waits on several.

The card says "This task becomes available when these are done." As soon as the last one is done, the
task is available. To stop waiting, remove the task from the list under **After**.

"After" is a Vikunja task relation (blocked by), so the Vikunja web app shows it too. When tasks wait
on each other in a loop, Vicu ignores the loop and says so on the card; remove one of them.

## Run a project step by step {desktop} {phone}

A project can say how its tasks relate. On the desktop, open the project's menu and choose **Type**:

- **Parallel**: every task can be done now. This is how projects work without Pro.
- **Sequential**: only the first open task is available; the next one comes up when it is done. Use the
  project's order, so set **Order tasks by hand (Manual)** when the order matters (same menu).
- **Single actions**: a bag of separate tasks with no order, like Errands.

Subtasks follow their parent: in a sequential project, the first open task's subtasks are available
with it.

## Put a project or label on hold {desktop} {phone}

When something is paused, put it on hold instead of moving its tasks around.

- **A project**: in its menu, **Status**, then **On hold**. Its tasks, and the tasks of its subprojects,
  wait with the reason **On hold**. Choose **Active** to bring them back.
- **A label**: right-click it in the sidebar and choose **Put on hold**. Every task with that label
  waits with the reason **Waiting**. This suits labels like "waiting for budget". **Make active** ends it.

Projects and labels on hold are synced with your account, so every device agrees.

## Flag what matters {desktop} {phone}

A flag marks the few tasks you do not want to lose sight of.

- Type `!flag` in a title.
- On the desktop, press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> (<kbd>Cmd</kbd> on a Mac) on a
  row, or use **Flag** on the open task.
- On the phone, use the flag in the task editor.

**Flagged** in the sidebar lists every flagged task, grouped by project, with the same
Available, Remaining and All switch. The flag is Vikunja's favorite star, so the web app shows it as a
favorite.

## Estimate how long a task takes {desktop} {phone}

Type `~30m`, `~1h` or `~1h30` in the title, or use **Estimate** on the open task. Estimates are shown on
the card and are used by [Plan my day](guide:plan) and by custom lists that pick quick wins (see
[Power tools](guide:pro/power)).

## Focus on one area {desktop}

Focus narrows the whole app to one area of your work, for example only your job's projects during the
day.

1. Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>, or choose Focus in the command palette.
2. Tick the **Categories** or **Projects** to keep.
3. Confirm. The sidebar, the lists and search show only those projects until you leave Focus.

Focus is per device ("Show only these on this device"), and the Inbox always stays. While Focus is
on, a line at the top of the sidebar names what is in focus: click it to change the choice, or click
its **x** (Clear focus) to see everything again.

## Repeat with an end {desktop} {phone}

With Pro on, a repeating task can end. In the repeat settings, **Ends** offers **Never**, **After
times** (a number of times) or **On a day**. **Catch up: skip dates that have passed** moves a repeating
task you completed late to the next date still ahead, instead of every date you missed.

## Details

- **Where it is stored.** Start dates, flags and "After" are Vikunja's own fields. A project's type and
  status and a label's status are synced with your account. Nothing is lost when you turn Pro off: lists
  show every task again and the values wait on your server.
- **The phone.** {phone} The phone has this part, with the switch and reasons on its lists, and Start,
  After, Estimate and the flag in the task editor. Focus is desktop only; on the phone, the **Work
  area** setting limits Pro's promises to the categories you chose.
- **Custom lists.** A custom list can pick tasks by availability, flag and estimate. See
  [Power tools](guide:pro/power).

## Related

- [What Pro is](guide:pro)
- [Promises and people](guide:pro/promises)
- [Smart lists](guide:lists)
- [Quick add syntax](guide:quick-add)
