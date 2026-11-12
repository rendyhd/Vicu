---
title: Quick add syntax
nav: Quick add
description: Every word Vicu reads in a task's title: dates, times, repeats, time blocks, projects, labels, priority and places, with examples of what each one produces.
lead: Type a task the way you would say it. Vicu picks out the dates, projects, labels, priority and repeats, shows them as chips, and keeps the rest as the title.
---

## In short

- **Type naturally.** `Call Ana tomorrow 3pm #work @call p2` makes a task called "Call Ana", due tomorrow at 3 PM, in the Work project, with the label call and high priority.
- **Everything Vicu reads is highlighted and shown as a chip.** Remove a chip and that text stays in the title. The rest of what you typed is the title.
- **The same rules everywhere.** The desktop, Android and iPhone read titles identically. It works in the new-task row, Quick Entry, pasted lines, voice and the phone's quick add sheet.
- **Pick your style.** Todoist style (`#project`, `@label`, `p1`) is the default. Vikunja style (`+project`, `*label`, `!1`) is in **Settings, General, Task Parser** on the desktop and **Settings, General, Input Parsing** on the phone. Parsing can be turned off there too.
- **Suggestions appear as you type.** After `#` or `@` (or `+` or `*` in Vikunja style), Vicu lists your projects or labels.

## Dates

A date can be anywhere in the title.

| You type | What you get |
|---|---|
| `today`, `tomorrow` | That day |
| `friday`, `this friday` | The next Friday, today included |
| `next friday` | Friday of next week. On a Tuesday, `next friday` is the Friday after this one. |
| `friday next week` | The same as `next friday` |
| `next week` | The Monday of next week |
| `next month` | The same day next month |
| `in 3 days`, `in 2 weeks` | That long from today |
| `jan 15`, `15 jan`, `march 3rd` | That date. If it already passed this year, it means next year. |
| `10/15` | In your system's order: month first for US English, day first for most other regions. If the first number cannot be a month, the order flips. |
| `2026-10-15` | That date, unambiguously |

A date without a time is due at the end of that day and shows without a time.

### Times

| You type | What you get |
|---|---|
| `3pm`, `3:30pm`, `3 p.m.` | That time |
| `at 14:00` | That time |
| `tomorrow at 3pm`, `friday 3pm`, `jan 15 9:30am` | The date with the time |
| `in 2 hours`, `in 30 minutes` | That long from now, to the minute |

A time with no date means today if it is still ahead, otherwise tomorrow.

### What Vicu does not read as a date

These stay in the title, so a task keeps its words:

- `weekend` and `weekday`: "Plan the weekend" has no date.
- The past: `yesterday`, `last friday`, `last week`, `2 days ago`.
- An amount of time on its own: "Call 30m" or "Rest 3 days". An amount counts only right after `in`.
- Three-letter weekdays by themselves: "Buy sun cream" has no date. `mon`, `tue`, `wed`, `thu`, `fri`, `sat` and `sun` count after `on`, `next`, `this`, `by` or `due`, or with a time (`wed 3pm`). Full names always count.
- A date inside another word or bracket: "Monday's report", "(tomorrow)", "Plan Friday/Saturday".
- `now`.

### More than one date

- The first date is the due date. "Book Friday dinner tomorrow" is due Friday.
- A weekday right before another date stays in the title: "Call Ana about Saturday tomorrow at 3pm" is due tomorrow at 3 PM.
- There are no ranges. "Trip friday to sunday" is due Friday, and the title is "Trip to sunday".
- A label, project or priority in the middle of a date splits it: "Call tomorrow @home 3pm" is due tomorrow with the title "Call 3pm".

### Words that go with a date

`on`, `by` and `due` before a date, and `at` before a time, leave with the date. "Submit report by friday" becomes "Submit report", and "Taxes due tomorrow" becomes "Taxes".

### Due today with an exclamation mark

A lone `!` at the start or end makes a task due today: `Buy milk !` or `! buy milk`. A `!` inside the text ("Hello! world") does nothing. It works even when parsing is turned off. On the desktop you can turn it off in **Settings, General, Task Parser**.

## Repeats

| You type | What you get |
|---|---|
| `every day`, `daily` | Every day |
| `every week`, `weekly` | Every week |
| `every month`, `monthly` | Every month |
| `every year`, `yearly`, `annually` | Every year |
| `every 3 days`, `every 2 weeks` | Every N days, weeks, months or years |
| `biweekly`, `fortnightly` | Every 2 weeks |
| `every monday` | Every week, and the due date is the next Monday. A time after it applies: `every monday 10am`. |

`daily`, `weekly` and the other one-word forms count only as the last word. "Water plants daily" repeats. "Weekly standup" and "Daily review tomorrow" do not, because the word describes the task.

If you also give a date, it is the first due date: `every friday starting oct 20` starts on October 20.

## Time blocks

`for` and a length, together with a time of day, set aside that time for the task.

| You type | What you get |
|---|---|
| `Call Sam tomorrow at 3pm for 30m` | A block tomorrow from 3:00 to 3:30 PM |
| `Write report at 9am for 2 hours` | Today from 9 to 11 AM, or tomorrow if 9 AM has passed |
| `Review at 10am for 1h30m` | From 10:00 to 11:30 AM |

- Lengths are `30m`, `90 min`, `2 hours`, `1h30m` or `1h 30m`, from 1 minute to 12 hours.
- Without a time of day, the words stay in the title: "Call tomorrow for 30m" is due tomorrow with the title "Call tomorrow for 30m". "Gift for mum" and "Table for 4" are never read as lengths.
- `for 3 days` and `for 3 months` are never dates.

See [Plan your day](guide:plan) for what a time block does.

## Projects and labels

| Style | Project | Label |
|---|---|---|
| Todoist (default) | `#work`, `#"side project"` | `@errand`, `@"grocery list"` |
| Vikunja | `+work`, `+"side project"` | `*errand`, `*"grocery list"` |

- Put a name with spaces in double quotes.
- A project name starts with a letter, so `review PR #142` keeps "#142" in the title.
- Vicu does not check that the project or label exists. Pick from the suggestions to be sure.
- In Vikunja style, `@john` stays in the title.

## Priority

| Priority | Todoist style | Vikunja style | Words (both styles) |
|---|---|---|---|
| Urgent | `p1` | `!4` | `!urgent`, `!critical` |
| High | `p2` | `!3` | `!high` |
| Medium | `p3` | `!2` | `!medium`, `!med` |
| Low | `p4` | `!1` | `!low` |

`p1` is the most urgent in Todoist style, as in Todoist. A word such as `p2p` is not a priority.

## Places

If you saved places on your phone, a phrase that names one sets a location reminder. {phone} {desktop}

| You type | What you get |
|---|---|
| `Call mom when I get home` | Title "Call mom", with a reminder when you arrive at Home |
| `Buy stamps when I leave work` | A reminder when you leave Work |
| `When I'm at the office, send the report` | With a saved place called Office: title "send the report", reminder on arriving there |

- Arriving phrases include `when I get`, `when I arrive at`, `when I'm at`, `when I get back to`, `once I get`, `arriving at`. Leaving phrases include `when I leave`, `when I'm leaving`, `once I leave` and `leaving`.
- Vicu reads it only for a place you saved, and only whole words: "when I get homework done" names no place.
- The reminder is created once the task reaches the server. A task created offline on the desktop gets none, and the composer tells you so.

See [Vicu on your phone](guide:phone#location-reminders-and-places).

## Pro phrases {pro}

When [Pro](guide:pro) is on, a few more words are read. With Pro off they stay in the title.

| You type | What you get |
|---|---|
| `Jan: send the deck friday` | A promise from Jan to you. Jan must be someone you marked as a person. |
| `for Jan: review the budget` | Your promise to Jan |
| `starts monday` | A start date. The task stays out of Available until then. |
| `~30m`, `~1h30`, `~45min` | An estimate of 30 minutes, 1 hour 30 minutes or 45 minutes |
| `!flag` | Flags the task |
| `req: can you add a report` | Marks a request for triage. The triage tools are on the desktop. |

Names for people are matched by their name, a name they go by, or an unambiguous first name. An unknown or ambiguous name stays in the title. See [Promises and people](guide:pro/promises).

## Examples

| You type | The task |
|---|---|
| `Buy groceries tomorrow 3pm #shopping @errands p3` | "Buy groceries", due tomorrow 3 PM, project Shopping, label errands, medium priority |
| `Submit report by fri` | "Submit report", due Friday |
| `Weekly standup every monday 10am @work` | "Weekly standup", repeats weekly, next Monday at 10:00, label work |
| `Water plants daily` | "Water plants", repeats every day |
| `Call Sam tomorrow at 3pm for 30m` | "Call Sam", a block tomorrow from 3:00 to 3:30 PM |
| `Dentist jan 15 9:30am` | "Dentist", due January 15 at 9:30 AM |
| `Call dentist !` | "Call dentist", due today |
| `Pay rent in 3 days` | "Pay rent", due 3 days from now |
| `Review PR #142` | The title is kept whole, with no project |
| `Plan the weekend` | No date: "weekend" is not a date |
| `Notes from last friday` | No date: the past is not read |
| `Trip friday to sunday` | "Trip to sunday", due Friday |
| `Call mom when I get home` | "Call mom", with a location reminder at Home |
| `Task +inbox *urgent !4` | In Vikunja style: "Task", project inbox, label urgent, urgent priority |

## Where it works

Quick add text is read in the new-task row on every list, the title editor, [Quick Entry](guide:desktop#quick-entry), pasted lines (one task per line), voice, and the phone's quick add sheet. On the phone, typed words move into chips as you type. On iOS, a title shared from another app is not parsed.

## Related

- [Add tasks](guide:capture)
- [Plan your day](guide:plan)
- [Vicu Pro](guide:pro)
- [Settings](guide:settings)
- [Keyboard shortcuts](guide:shortcuts)
