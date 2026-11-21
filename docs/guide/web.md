---
title: Vicu in a browser
nav: In a browser
description: Vicu web is the desktop app's main window as a website that you or your organization host next to a Vikunja server, for a computer where you cannot install an app. What it has, what it leaves out, and how signing in works.
lead: Vicu web is for the laptop you are not allowed to install anything on. It is the same Vicu, opened in a desktop browser at an address that you or your organization host. It has no app to install and nothing to update.
---

## In short

- **Someone hosts it.** Vicu web is a small container that runs next to a Vikunja server. There is no public Vicu web address: you open the one your organization, or you, set up.
- **It is the main window of the desktop app.** Lists, projects, the Plan screen, routines, custom lists, comments, sharing, guided sessions and Pro all work, on the same account as your other devices.
- **It needs a connection.** Nothing is kept for later. A change made while the server cannot be reached fails, and Vicu says so.
- **Some desktop features are not in it**, mostly the ones that need a program on the computer. They are listed below.
- **It is made for a desktop browser.** On a phone, use the [phone app](guide:phone).

## Signing in

Open the address and sign in the way your server allows: with your username and password, with your organization's sign-in, or with an API token.

- **Username and password, or your organization's sign-in.** You stay signed in on that browser until you choose **Settings, General, Sign Out** or the server ends the session. With your organization's sign-in the browser goes to its page and comes back. Passkeys and security keys work.
- **An API token.** Vicu keeps the token for that browser tab and forgets it when you close the browser. Tick **Remember on this browser** only on a computer that is yours.

After the first sign-in Vicu asks which project is your Inbox. If one of your other devices already chose it, it is selected for you.

> [!WARNING]
> On a shared or borrowed computer, sign out when you are done. Closing the tab does not end a password or organization sign-in.

**Sign Out** ends the session on the server. If the server cannot be reached at that moment, Vicu says so and you stay signed in, so try again once you are connected. With your organization's sign-in you may still be signed in there afterwards: Vicu takes you to its sign-out page when your server is set up for that, and otherwise you sign out there yourself.

## What is the same

Everything you do with tasks: adding them with [quick add](guide:quick-add), dates, repeats, reminders, labels, notes, checklists, subtasks, attachments, [projects](guide:projects) and their order, [custom lists](guide:custom-lists), [routines](guide:routines), [Plan](guide:plan) with time blocks and your own Events, [comments and sharing](guide:collaboration), [reviews and guided sessions](guide:review), and [Pro](guide:pro). Your settings that sync, such as the Inbox, the week start and project categories, are the same as on your other devices.

More than one tab can be open. A change in one shows in the others.

## What is different

| On the desktop | In a browser |
|---|---|
| Changes made offline wait and are sent later | No offline use. You need a connection, and a change that cannot be sent fails |
| Reminders from the system, also while Vicu is in the tray | Browser notifications, only while a Vicu tab is open. Allow them once in **Settings, Notifications** |
| Open an attachment in its app | A picture, PDF or text file opens in a new tab. Other files are downloaded |
| Attach files with the system's file dialog | The browser's file picker. Dropping and pasting files work as on the desktop |
| <kbd>Ctrl</kbd>+<kbd>N</kbd> makes a task | <kbd>Alt</kbd>+<kbd>N</kbd>. The browser keeps <kbd>Ctrl</kbd>+<kbd>N</kbd> for a new window |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> makes an Event on Plan | <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> |
| <kbd>Ctrl</kbd>+<kbd>T</kbd> sets a task due today | Type <kbd>!</kbd> on the task. The browser keeps <kbd>Ctrl</kbd>+<kbd>T</kbd> for a new tab |
| The language follows the computer | The language follows the browser, unless you choose one in **Settings, General** |

A link in a task's notes opens in a new tab, so Vicu stays where it was.

## What is not in it

- **The assistant** and **voice input**: Ask, smart dictation, brain dump, tasks from notes, suggestions in guided sessions and Plan my day's suggestions.
- **Connected calendars** on the Plan screen. Your own Events are there, and you can still import a calendar file into Events.
- **Quick Entry and Quick View**, and their shortcuts that work in any app.
- **The browser extension's link and Obsidian links.**
- **Working without a server.**
- **Your own completion sound.** The built-in sound plays.
- **The count on the app icon**, the tray, starting with the computer and the check for a new version. The page is always the version your host runs.

Nothing is shown greyed out for these: they are simply not there.

## Reminders

Vicu web reminds you with the browser's notifications, and only while a Vicu tab is open. The tab may be in the background.

1. Open **Settings, Notifications**.
2. Choose **Allow notifications** and accept the browser's question.

If the browser blocks notifications for the site, or you say no, reminders show inside Vicu instead, the next time you look at the tab. A reminder that came due while the computer slept shows when it wakes, if it is not more than 20 minutes late. With several tabs open you get each reminder once.

For reminders that reach you when no tab is open, use the desktop or phone app as well. They read the same reminders.

## Privacy on a computer that is not yours

- A password or organization sign-in keeps nothing in the browser that could sign someone else in later, apart from the session itself, which **Sign Out** ends.
- While you are signed in, the browser holds a copy of your settings and of what syncs with them: your custom lists, your own Events, and Pro's records if you use Pro. Your tasks themselves are never stored in the browser. **Sign Out** removes that copy; the theme and the sidebar's layout stay.
- Files you open or save go to the browser's downloads, like any download.

## Hosting it

Vicu web is a container image that serves the app and passes requests on to your Vikunja server. The page for the person who sets it up is `docs/web.md` in the Vicu repository.

## Related

- [Vicu on the desktop](guide:desktop)
- [Vicu on the phone](guide:phone)
- [Sync and offline](guide:sync)
- [Settings](guide:settings)
