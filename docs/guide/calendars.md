---
title: Events and calendars
nav: Events and calendars
description: Add your own repeating Events and show your work and personal calendars on the Plan screen, so meetings count as busy time when you plan.
lead: Tasks are only part of what takes your time. Events and calendars put meetings next to your time blocks, so a plan leaves room for them.
---

## In short

- **Events** are your own entries on the Plan screen: a weekly manager call, a month-end close. They repeat if you want, and they sync to all your devices through your Vikunja server.
- **Connected calendars** show other calendars (work, personal, family) on the Plan screen. They are read only: Vicu never changes them.
- **Both count as busy time**, so free time, Fit and Plan my day keep clear of them.
- **They show on Plan only**, not on Today, in lists or in reminders.
- **Calendar data stays on the device.** It is never sent to your Vikunja server, your other devices or the assistant. The assistant only gets free time ranges, never an event's title.
- You need the [Plan screen](guide:plan) turned on to see any of this.

## Your own Events {all}

An Event is not a task. It has nothing to tick off. It says "I am not available then". Events are saved as part of your synced settings, so they appear on every device where Plan is on.

### Add an Event

> [!DESKTOP]
> Drag on an empty time on the timeline and pick **Event**, or choose **New event** in the command palette, or press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> (<kbd>Cmd</kbd> on a Mac) while on Plan. The title box understands quick-add text.

> [!PHONE]
> Press and hold an empty time on the timeline and choose **Event**. The gear also lists your Events and has **New event**.

An Event has a title, **All day** or a start time and length, how it repeats, when it ends (**Never** or **On a date**) and **Counts as busy time**. The repeat list offers choices that fit the day you pressed, such as "every week on Tuesday".

### Move and resize

Events move and resize like blocks: drag, drag an edge, or use the keyboard (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>Up</kbd> or <kbd>Down</kbd> to move, <kbd>Shift</kbd>+<kbd>Up</kbd> or <kbd>Down</kbd> to change length) on the desktop. On the phone, press and hold to move and drag the handle to change length.

### Change a repeating Event

When an Event repeats, Vicu asks which times your change is for:

- **This time only**
- **This and following**
- **All times**

On the desktop the question appears in a small menu after you let go of a drag, and the Event's popover has a **Change** selector at the top for the same choice. On the phone it is asked when you save. **Skip this one** and **Delete** are in the Event too, and each has Undo.

> [!NOTE]
> If you change the repeat or the end, it applies to this and following times or to all times, not to a single time.

### Delete an Event

Open the Event and choose **Delete event** (on the phone, Delete). On the desktop you can also delete from **Settings, Pro, Plan** where your Events are listed. Undo brings it back.

## Connected calendars {all}

### How to add one {desktop}

:::steps
1. Open **Settings, Pro, Plan**, or open the Plan gear and choose **Manage**.
2. Under **Calendars**, choose **Add a calendar**.
3. Pick the kind, follow the form and choose which calendars to show.
:::

The kinds you can add on the desktop:

| Kind | Good for | What you do |
|---|---|---|
| **Calendar link** | Any calendar with a secret iCal (.ics) address | Paste the link, name it, choose **Add calendar**. The dialog says where Google, Outlook, iCloud and Proton keep that address. |
| **CalDAV account** | iCloud, Fastmail, Nextcloud and other CalDAV servers | Enter the **Server address** and an **App password**, sign in, pick which calendars to show. |
| **Microsoft 365** | Outlook.com and work or school accounts | Sign in in your browser, then pick calendars. |
| **Google** | Google Calendar, personal or Workspace | Sign in in your browser, then pick calendars. |
| **Mac calendars** {desktop} | The calendars in macOS Calendar | macOS asks once whether Vicu may read them. No sign-in in Vicu. |
| **Classic Outlook** {desktop} | The calendars of classic Outlook on a Windows PC | Read the warnings, tick that you may show them, then pick calendars. |
| **Calendar file** | An `.ics` file another program keeps up to date | Name it and choose the file. |

**Mac calendars** is offered on macOS only. It lists everything you added in System Settings, Internet Accounts, and picks up a change at once.

### A calendar file on this computer

Any program that can write an `.ics` file can feed Plan: Thunderbird, a script, a scheduled export. Choose **Calendar file**, give it a name and choose the file. Vicu reads it again as soon as the file changes, and never writes to it.

- Keep the file where it is. If it moves or is deleted, the calendar keeps its last copy and says the file is no longer there. Remove the calendar and add the file again from its new place.
- A file is read whole, up to 15 MB.
- To copy a file's events into your own Events once instead, use [Import a calendar file](#import-a-calendar-file).

### Classic Outlook on Windows

**Classic Outlook** is offered on Windows only. It reads the calendars of the desktop Outlook on this PC, and the data stays on the PC. Before you add it:

- Only classic Outlook can be read, and only while it is open. Vicu never starts it. The new Outlook has no way for other apps to read it: add that account as **Microsoft 365** or a **Calendar link** instead.
- Outlook may ask whether to allow a program to access its data. Vicu reads only titles, places, times, "show as" and how you answered, not people or messages.
- On a work PC, this shows your organisation's calendar in Vicu. Check that your organisation allows it.

The form asks you to tick **These are my calendars, and I may show them in Vicu on this PC** before it reads Outlook. While Outlook is closed, the calendars keep their last copy and say "Open classic Outlook to read its calendars".

### Microsoft 365 and Google

Vicu asks for read-only access. For Microsoft 365 it uses the permission that reads your calendar list and events, and for Google two read-only permissions. Vicu cannot create, change or delete anything and cannot answer invitations.

If your organization does not let people approve apps themselves, you see "Your organisation needs to approve Vicu". Send your IT team the page for them: [Vicu and your organisation's calendars](https://github.com/rendyhd/Vicu/blob/main/docs/calendar-it-admins.md). It lists the permissions and how an administrator can approve Vicu for everyone. The same button is in the sign-in form as **The page for your IT team**.

If sign-in stops working, a **Sign in again** button appears on the account. **Advanced: use my own client** lets you register your own app with Microsoft or Google and use that instead of Vicu's.

### Settings for each calendar

Each calendar has:

- A checkbox to show or hide it on Plan
- A colour
- **Counts as busy time**
- **Show only "Busy", not titles**: Vicu then keeps no titles or places for that calendar at all, only that you are busy

Timed, busy events of calendars that count are busy for free time, Fit, the load bars on the phone and Plan my day. All-day and free events are not busy.

### How often calendars are read

Vicu reads calendars when you open Plan and again when the window comes to the front, but at most every 5 minutes. A copy of the last read is kept so Plan works offline. If a calendar cannot be read, it keeps the last good copy and says "Not updated since" with the time.

To read at once on the desktop, press <kbd>F5</kbd> or <kbd>Ctrl</kbd>+<kbd>R</kbd> (<kbd>Cmd</kbd>+<kbd>R</kbd> on a Mac), choose **Refresh** in the command palette, or use the **Read the calendars again** button in Settings. On the phone, pull down on the timeline.

### Phone calendars {phone}

> [!PHONE]
> The phone does not add accounts of its own. In the Plan gear, choose **Calendars**. Vicu asks to read your calendars and lists the ones the phone already has, grouped by account.
>
> - On Android that is what the phone syncs: Google, Exchange through Outlook, iCloud or other CalDAV through DAVx5, subscribed links through ICSx5.
> - On an iPhone or iPad it is the accounts in Settings, Calendar: iCloud, Google, Exchange, CalDAV and subscriptions. Access is asked once and is full access, because the system has no read-only choice.
>
> Each calendar can be shown or hidden, take a colour, count as busy or not, and show only Busy. Vicu never writes to these calendars. If you refuse access, your own Events still work.

## Import a calendar file {all}

You can turn an `.ics` file into your own Events. This suits a school timetable, public holidays or an exported work schedule.

:::steps
1. Open the Plan gear and choose **Import calendar file...** (desktop), or **Import calendar file** in the gear (phone).
2. Pick the file. A preview shows how many repeating and single Events it will make, and each one.
3. Optionally tick **Show only "Busy", not titles** to make every title Busy.
4. Choose **Import**. All Events are added at once, with one Undo.
:::

Rules for the import:

- A series Vicu can repeat (daily, weekly, monthly on a date or weekday, yearly, with its end and skipped days) becomes one repeating Event.
- Anything else becomes single Events. On the phone, that means the next 12 months.
- Times with a time zone become your local time.
- The desktop imports up to 500 Events at a time, and leaves out Events that ended before today, cancelled ones and those more than a year ahead.
- Afterwards the Events are yours. They sync, you can change them, and nothing stays linked to the file.

## Privacy and security {all}

- Calendars are read on this device only. They are never sent to your Vikunja server, to your other devices or to the assistant.
- On the desktop, sign-in tokens and the saved copy are encrypted with your system's protection. On a Linux system without a keyring, Settings warns that links and passwords are only obscured.
- Removing a calendar account in Settings deletes its tokens and copy from the device.
- Your own Events are different: they are part of your synced settings on your Vikunja server, like your custom lists.

## For IT administrators {desktop}

Work calendars often need an administrator to approve an app. The page [Vicu and your organisation's calendars](https://github.com/rendyhd/Vicu/blob/main/docs/calendar-it-admins.md) explains what Vicu asks for, where the data goes, and how to grant consent for the whole organization in Microsoft 365 and Google Workspace.

## Related

- [Plan your day](guide:plan)
- [Routines](guide:routines)
- [The assistant](guide:assistant)
- [Settings](guide:settings)
