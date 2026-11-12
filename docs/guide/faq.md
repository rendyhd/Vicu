---
title: Troubleshooting and FAQ
nav: Troubleshooting and FAQ
description: Answers to common Vicu problems: sign-in and passkeys, API token permissions, sync and offline, tasks that seem to have vanished, Linux, macOS and Windows notes.
lead: Quick answers for when something does not work the way you expect. Find your question, try the fix, and if it is still wrong, report it.
---

## In short

- **Sign-in trouble:** check that your server runs Vikunja 2.4.0 or newer, then see the sign-in section below.
- **Changes not showing on another device:** refresh (<kbd>F5</kbd> on the desktop, pull down on the phone) and look at the sync status.
- **A task seems gone:** it is probably in the Logbook, hidden by a filter, or waiting for a start date. See "My task disappeared".
- **Still stuck?** [Open an issue](https://github.com/rendyhd/Vicu/issues) and say what you did and what you saw.

## Sign-in and connecting

### Which Vikunja version do I need?

Vikunja 2.4.0 or newer, on your own server or on Vikunja Cloud. Vicu has no server or account of its own.

### Single sign-on shows an endless spinner or "An unknown error occurred"

Your identity provider probably asks for a **passkey** (Pocket ID does, for example). Passkeys cannot complete inside Vicu's own sign-in window on macOS and Linux, and in the iPhone and Android in-app sign-in.

1. On the sign-in screen, choose **Uses a passkey? Sign in through your browser**. Vicu also offers this by itself when it notices a passkey prompt.
2. Copy the redirect address Vicu shows, using its **Copy** button.
3. Add it once as a redirect (callback) URL of the Vikunja client at your identity provider. On the desktop the address is `http://127.0.0.1:47823/vicu/oidc-callback`. On the phone it is `com.rendyhd.vicu:/oidc-callback`.
4. Start the browser sign-in again.

Vicu remembers which way you signed in and uses it again when you have to sign in again. On Windows the desktop app is not affected, because Windows Hello handles passkeys.

### My provider refuses to sign in on iPhone

{ios} Some providers, Google among them, refuse to sign in inside an app's web view. Use **Sign in through your browser**, a username and password, or an API token.

### "Session expired", or the app asks me to sign in again

Your sign-in ran out. Sign in again. Waiting changes are kept and sent afterwards. See [Sync and offline](guide:sync).

### I use an API token and some things fail

Vikunja answers 401 when a token lacks a permission group. Vicu tells you which one is missing instead of saying the session expired. A token needs these permissions:

| Permission group | Used for |
|---|---|
| `tasks`, `projects`, `labels` | Reading, creating, changing and deleting them |
| `task_labels` | Adding and removing labels |
| `task_relations` | Subtasks and relations |
| `task_attachments` | Files on tasks |
| `project_views` | Task position and sorting |

For [collaboration](guide:collaboration), the token also needs task comments, task assignees and project sharing. Without them Vicu says what is missing. Changes the token may not send go to the failed list, and the rest continue. Password and single sign-on logins have full access, so they avoid all of this. Following a task for comments ("Notify me") works only with those logins.

On the desktop, a small **i** next to the token field lists the permissions.

### Vicu warns about an `http://` address

An `http://` address outside your own network sends your sign-in unencrypted. Use `https://` where you can. A server with a certificate from your own certificate authority works on Android once that certificate is installed on the phone.

## Sync and offline

### My changes do not show on my other device

1. Refresh. <kbd>F5</kbd> on the desktop, pull down on a list on the phone.
2. Check the sync status. On the desktop a button appears at the bottom of the sidebar if something waits or failed. On the phone see **Settings, General, Data & Sync**.
3. Open the panel and **Retry all** if something failed.

### A change failed and I do not know why

The sync panel gives a reason beside each failed change: the task was deleted elsewhere, a file is too large, you may no longer edit that project, or your token is not allowed. Fix the cause, then **Retry**, or **Discard** the change. See [Sync and offline](guide:sync#the-sync-status-button).

### Does Vicu work offline?

Yes. You can add, edit, complete and delete tasks. They wait and go out in order when the connection returns. Sharing, uploading a file to a comment and some creating of projects need a connection.

### My custom lists or settings are not on the new device

They travel through your server in the background. Make sure the old device has synced (it may show "Lists and settings" in the sync panel), then refresh the new one. See [Settings](guide:settings) for what syncs.

## My task disappeared

Nothing in Vicu deletes a task by itself. Check these first.

- **You just completed it.** A completed task stays in the list for about 5 seconds, then collapses, and a **Completed** message with **Undo** appears. Finished tasks live in the **Logbook**. On the phone, **Settings, General, Logbook** can hide older completed tasks, but it never deletes them.
- **It is not due yet.** Today shows what is due today and overdue. Upcoming starts tomorrow. A task with no date is in Anytime, or in the Inbox.
- **A filter hides it.** Search has filter chips for date, status, labels and priority. A custom list shows only what matches its conditions.
- **Its project is archived.** Archived projects are collapsed under **Archived** in the sidebar. Restore the project to bring it back.
- **Pro is on and it has a start date.** Lists can show **Available**, hiding tasks that start later or wait on others. Use **Show** or switch the list to **All**. See [Know what you can do now](guide:pro/available).
- **It is not a task at all.** Vicu keeps custom lists, routines, synced settings and Pro records in hidden tasks. Vicu hides them everywhere, and you may see them in the Vikunja web app. Leave them there.

### Why do I see strange tasks in the Vikunja web app?

Those are Vicu's hidden tasks, such as "Vicu preferences (sync metadata — do not delete)". Do not delete or edit them. Deleting one deletes the data it holds.

## Linux

- **Global shortcuts do nothing on Wayland.** Accept the GlobalShortcuts consent dialog if it appears. If it does not work, add the command shown in **Settings, Quick Entry / View** as a custom shortcut in your desktop's keyboard settings. See [On the desktop](guide:desktop#global-shortcuts-and-wayland).
- **No tray icon on GNOME.** Install the AppIndicator extension.
- **Voice input.** There is no built-in speech recognizer on Linux. The voice shortcut and "Say a task" open the new-task box instead and say that voice input is not available.
- **Obsidian links** are not available on Linux, and browser links need the browser extension.
- **Updating the AppImage.** The AppImage carries update information, so tools such as AppImageUpdate and Gear Lever can update it. It needs no FUSE 2.

## macOS

- **Notifications.** The first notification asks you to allow Vicu. If you said no, allow it in System Settings.
- **Microphone and speech recognition.** Asked the first time you use voice. Allow both. Apple may send speech to its servers when the language is not recognized on the Mac. **Settings, Keyboard Shortcuts** says which.
- **Browser links.** On first use, macOS asks you to let Vicu control the browser.
- **Calendars.** Choosing **Mac calendars** when you add a calendar asks macOS once for access to your calendars. If you refused, allow Vicu in System Settings, under Privacy & Security, and try again. See [Events and calendars](guide:calendars).

## Windows

The installer is not code-signed, so Windows SmartScreen may say it protected your PC. Choose **More info**, then **Run anyway**. Updating keeps Vicu pinned to the taskbar.

## Where is my data?

- **Your tasks and most settings are on your Vikunja server.** Vicu has no server of its own and collects nothing. No analytics, no ads, no account.
- **The desktop app** keeps a working copy, your device settings, waiting changes and your sign-in in its own folder (named `vicu`): `%APPDATA%\vicu` on Windows, `~/Library/Application Support/vicu` on macOS and `~/.config/vicu` on Linux. The sign-in is encrypted with your system's protection. If your system cannot encrypt it, Settings says so.
- **The phones** keep a copy in the app. Android keeps the sign-in encrypted, and iOS keeps it in the Keychain.
- **Calendars you connect and the assistant's key** stay on the device. Calendar events never go to your server or the assistant.
- **A deleted Vicu does not delete your tasks.** They stay on your server.

## Report a bug

Open an issue and say which app and version you use, what you did, what you expected and what happened. A screenshot helps.

- Desktop: [github.com/rendyhd/Vicu/issues](https://github.com/rendyhd/Vicu/issues)
- Phone: [github.com/rendyhd/Vicu-Mobile/issues](https://github.com/rendyhd/Vicu-Mobile/issues)

Every page of this guide has a link at the bottom to suggest a change.

## Related

- [Sync and offline](guide:sync)
- [Settings](guide:settings)
- [On the desktop](guide:desktop)
- [On your phone](guide:phone)
- [Glossary](guide:glossary)
