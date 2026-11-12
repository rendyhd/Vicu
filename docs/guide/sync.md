---
title: Sync and offline
description: How Vicu keeps your devices in step through your Vikunja server, what syncs and what stays on one device, and what happens when you are offline.
lead: Your Vikunja server is the one source of truth. Every device reads from it and writes to it, so you see the same tasks and lists everywhere. When the connection drops, Vicu keeps working and catches up later.
---

## In short

- **The server holds your data.** Vicu has no server of its own. Each device keeps a copy to work from and stays in step with your Vikunja server.
- **Tasks, lists and many settings follow you.** Custom lists, your Inbox choice, categories, templates, task order, Events and more sync. Look and behavior settings stay on each device.
- **Offline works.** You can add, edit and complete tasks without a connection. The changes wait in a queue and go out in order when you are back.
- **Only what you changed is sent.** An edit on your phone never undoes one you made on your computer.
- **You can see what is waiting.** On the desktop, a status button appears in the sidebar. On the phone, a banner and **Settings, General** show it.

## How devices stay in step

Each Vicu app asks the server for fresh data and sends your changes to it.

- {desktop} Vicu refreshes when you return to the window (at most every 30 seconds), every 5 minutes while you look at it, after your computer wakes up, and at midnight so Today rolls over. Press <kbd>F5</kbd> to refresh the page on request.
- {phone} The app syncs when you open it, when you pull down on a list, and in the background: about every 30 minutes on Android, and when iOS allows it on iPhone and iPad.

Reminders and widgets update after each sync.

## What syncs and what stays on one device

**Follows you to every device and to the Vikunja web app** (stored in your server's own fields): tasks, projects, labels, due and start dates, reminders, attachments, comments and assignees.

**Follows you to every device through Vicu** (stored on your server in hidden tasks, see below):

- Custom lists
- Routines and their history
- Your Inbox project
- Task order, per project and global, and the order of subtasks
- Project categories and project icons
- Task templates
- Your own Events, the Plan default length and your work hours
- Saved places (names only) and location reminders
- The date of your last weekly review
- Which shared routines you hid or muted
- Vicu Pro data, while you use it

**Stays on each device:**

- Theme, clock, task row density and the other look settings
- Quick-add syntax, notification choices, hotkeys, Quick Entry and Quick View
- Whether Plan, Pro and the assistant are turned on, and the assistant's provider and key
- Connected calendars and which ones you show
- On the phone: the bottom bar, widgets and swipes
- Where a saved place is. Only its name travels.

[Settings](guide:settings) marks every setting as synced or per device.

### The hidden tasks

Vikunja has no place for an app's own data, so Vicu keeps custom lists, routines, synced settings and Pro records in tasks that it marks done and hides everywhere in Vicu. You may see them in other Vikunja apps. Names include "Vicu preferences (sync metadata — do not delete)". Leave them in place. Deleting one deletes that data.

Each person's Vicu reads only the hidden tasks that person created, so sharing an Inbox with someone does not mix your settings.

## The offline queue

Without a connection, Vicu keeps working from the copy it holds. The app opens with your last lists, and these changes wait in a queue: creating, editing, completing and deleting tasks, labels, pasted images and files, comments, assignees, and project edits.

- Changes go out in the order you made them, one at a time.
- A task created offline gets a temporary id and is sent first, with its labels and files after it.
- {desktop} If a send fails because of the network or the server, Vicu retries after 5 seconds, then 15 seconds, then every minute.
- {phone} Waiting changes are sent within seconds of getting a connection back.
- A create that timed out may already have reached the server. Vicu says so and asks you to check before trying again.

Some things need a connection: sharing a project or a routine, uploading a file to a comment, and creating new projects from a brain dump.

### The sync status button

{desktop} When something is waiting or has failed, a button appears at the bottom of the sidebar. It shows how many changes are waiting, how many failed, and whether you need to sign in again. Click it to open **Sync status**.

- **Waiting to sync** lists changes not sent yet, with **Sync now**.
- **Failed** lists changes the server refused, with the reason, and **Retry all** and **Discard all** (or the same for one change). The server refuses a change when, for example, the task was deleted elsewhere, a file is too large, you may no longer edit that project, or your API token is not allowed to do it.
- **Lists and settings** shows custom-list and settings changes that have not reached the server, with **Sync now** and **Discard**. Discard sets them back to what the server holds.
- If your session expired, it asks you to sign in again. Waiting changes are kept and sent once you are in.

When everything is synced the panel says "Everything is synced" and the button hides.

### On the phone {phone}

**Settings, General, Data & Sync** shows whether you are **Connected** or **Offline** and how many changes are pending or failed. **Sync Now** sends them, **Retry All** tries the failed ones again, and **Clear Failed** drops them. **Clear Cache & Re-sync** deletes the local data and fetches everything from the server, with an option to discard unsynced changes too. A failed change is dropped after 14 days.

The [connection banner](guide:phone#the-connection-banner) tells you when the phone is offline.

## Signing out and signing in as someone else

- **Signing out** first tries to send what is waiting. If something has not reached the server, Vicu asks before it signs you out. Unsynced custom-list and settings edits would be lost. Queued task changes stay for the next sign-in to the same account.
- **A different user or server.** Signing in as someone else clears the previous account's custom lists, Inbox choice and synced data, so two people on one computer never see each other's lists. Device settings such as the theme stay. Changes made for one account are never sent to another.
- **Sign-in expired.** If your session runs out, Vicu keeps your changes and asks you to sign in again. Sign in the same way you did before. If you used the browser sign-in, it starts that way again.

## Standalone mode

{desktop} Earlier versions of the desktop app could keep tasks on the computer only, without a server. New setups always connect to a server, but if you still use that mode, it keeps working: it has no Plan screen, no time blocks, no Pro, and no synced settings. When you later connect to a server, Vicu offers to upload the local tasks to your Inbox.

## Sessions in Vikunja

Each device that signs in appears under **Settings, Sessions** in Vikunja, named like "Vicu/3.0.0 (Windows; HOSTNAME)" or "Vicu/3.0.0 (Android; Pixel 8)", so you can tell them apart and end one. Password and single sign-on logins also create a backup API token titled "Vicu — host [id]", valid for 365 days. Signing out revokes it.

## Details

- **No overwrites.** Each edit sends only the fields you changed. An edit made on another device in the meantime stays.
- **Writes go one at a time**, because Vikunja's default database answers parallel writes with "database is locked".
- **Many tasks at once.** If the network fails partway through a bulk change, the remaining tasks go straight to the queue instead of each waiting for a timeout.
- **Servers with a broken search.** Some Vikunja servers answer searches with an error. Custom lists, settings and routines still load.

## Related

- [Settings](guide:settings)
- [Vicu on your phone](guide:phone)
- [Vicu on the desktop](guide:desktop)
- [Troubleshooting and FAQ](guide:faq)
