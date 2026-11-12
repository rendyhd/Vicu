---
title: Vicu on your phone
nav: On your phone
description: What the Android, iPhone and iPad apps add: widgets, sharing to Vicu, swipes, notifications, location reminders, the drawer, Pure black and the connection banner.
lead: The phone app is the same Vicu as on the desktop, shaped for one hand and for a pocket: widgets, the share sheet, swipes, reminders that follow you around, and a bottom bar you set up yourself.
---

## In short

- **One app for Android, iPhone and iPad.** It reads your tasks by the same rules as the desktop app, so a due date, a custom list or a task order means the same thing everywhere.
- **Add tasks from outside the app** with widgets, the share sheet, a Quick Settings tile ({android}), Siri and the Control Center ({ios}), and the shortcuts you get when you hold the app icon.
- **Swipe** a task right to complete it and left to schedule it. You can change both in **Settings, Gestures**.
- **Reminders** come as notifications with **Mark Complete** and **Snooze 15 min**. Location reminders fire when you arrive at or leave a place.
- **The drawer and the bottom bar** are yours to arrange. **Settings, General** holds most choices.
- **Offline is normal.** A banner says when the phone cannot reach the server, and waiting changes are sent when it can.

## Widgets {phone}

Add a widget the way you add any widget on your phone.

| Widget | What it does | Where |
|---|---|---|
| Tasks | Shows any list, smart, project or custom, and lets you tick tasks off | {android} {ios} |
| Routines | Shows today's routines with their times. Tap the circle to log one. | {android} {ios} |
| Quick add | A small widget with a microphone and a + button. The microphone adds a task by voice without opening the app. | {android} |

- **On Android** the widgets follow the Vicu colors or your wallpaper colors, and they refresh right after a tap. When you add the Tasks widget, its setup screen also offers **Transparent background**.
- **On both** **Settings, General, Widget** has **Smart add button** (the + adds to the widget's own project or list) and **Context navigation** (tapping the title opens that list).
- **On iPhone and iPad** you choose the list in **Edit Widget**, and the Tasks widget comes in small, medium and large. The + button is in the medium and large sizes. A small widget has one tap target and opens the list. A tap in a widget is stored and sent the next time the app runs, so it can take a moment to reach the server.

## Add a task from anywhere

:::cards
- [Quick add](guide:quick-add): Type dates, labels and projects in the title.
- [Add tasks](guide:capture): Every way to capture a task, on every device.
:::

- **Hold the app icon** and choose **Add task** or **Dictate**. {phone}
- **Quick Settings tile.** {android} Open **Settings, Notifications, Quick Add tile** and tap **Add tile**. The tile then opens the task entry from the notification shade.
- **Add task control.** {ios} On iOS 18, add the control to Control Center, the Lock Screen or the Action Button. **Settings, Notifications** shows how.
- **Siri.** {ios} Say "Hey Siri, add a task in Vicu". Siri asks "What's the task?" and adds it without opening the app, also on a locked phone. The words are read like quick add. In the Shortcuts app you can pair "Dictate Text" with Vicu's "Add a task" for a one-step Action Button.
- **TalkBack.** {android} The + button has a **Say a task** action.
- **Hold + and speak.** {phone} Hold the + button, say the task, and let go to add it. Slide down to cancel.

## Share to Vicu {phone}

Share a link, a photo, a video or a file from any app and choose Vicu.

- **Android** opens the full task entry, with the title and files filled in.
- **iPhone and iPad** show a small native sheet with the title, notes and attachments. Tap **Add**, and the task goes into the Inbox the next time Vicu runs or gets a connection. Quick add's parsing does not apply to a shared title on iOS.
- A shared screenshot starts with an empty title.
- If you shared text and the [assistant](guide:assistant) is set up, **Make tasks** turns it into task cards.

## Swipes and gestures {phone}

By default, swiping right completes a task and swiping left opens **Choose when**. To change them, open **Settings, Gestures**, tap **Swipe Right** or **Swipe Left**, and pick one of:

**Complete**, **Choose when**, **Due today**, **Due tomorrow**, **Mark urgent**, **Move to project**, **Delete**, or **Nothing**.

A swipe needs a drag of half the row's width. **Delete** always asks first. Other gestures:

| Gesture | What it does |
|---|---|
| Tap | Opens the task |
| Long press | Selects several tasks |
| Long press and drag | Reorders tasks where the order is manual, and projects, lists and labels in the drawer |
| Tap the checkbox | Completes the task. Tap it again within a few seconds to undo. |
| Pull down at the top | Refreshes |

With TalkBack, every row offers **Move up** and **Move down** instead of dragging.

## Notifications

{phone} Open **Settings, Notifications**. The app asks for the notification permission after setup, and again when you turn on something that needs it.

- **Task reminders.** Each has **Mark Complete** and **Snooze 15 min**. A reminder never reopens a task that is already done.
- **Daily Summary.** A morning notification, and optionally an **Afternoon Summary**, that count overdue, due today and (with **Include Tomorrow**) due tomorrow tasks.
- **Default Reminder.** Added to every new task that has a due date and no reminder of its own. You choose the offset and what it is relative to (due, start or end date).
- **Send Test Notification** checks that it all works.

> [!NOTE]
> **Android** checks the task on the server just before a reminder rings, and syncs about every 30 minutes in the background. **iPhone and iPad** plan up to 60 of the soonest reminders ahead, because iOS keeps only a limited number waiting, and sync when iOS allows it. A reminder for a task you completed on another device can still show until the iPhone has synced. See [Android and iOS differences](guide:phone#android-and-ios-differences).

## Location reminders and places

{phone} A task can remind you when you **arrive at** or **leave** a place. Open the task, tap the reminder, and choose **At a location**.

1. Pick a saved place, search for an address, or use where you are now.
2. Choose Arrive or Leave and a radius of 100, 200 (the default) or 500 meters.
3. The reminder fires once, also with the app closed, and never for a task that is done.

The notification says "Arriving at Home" or "Leaving Work" and has **Mark Complete** and **Snooze 15 min**.

- **Save places** in **Settings, Notifications, Places**, or choose **Save as place** when you set a reminder. In quick add or when you speak, `when I get home` and `when I leave work` set one for a saved place.
- **Privacy.** Only a place's name and your reminders sync. Where a place is stays on the phone that saved it. Another phone lists it as "Not set on this phone" until you tap **Set location**. The desktop shows your places and can set a reminder at one, but only phones fire them.
- **Permission.** Vicu explains first, then asks for location access set to **Always**. A reminder set while you are already at the place waits for the next arrival.
- **Limits.** iOS can watch 20 places at once and Android 100. Address search sends only what you typed (Android uses Photon and OpenStreetMap, iOS uses Apple Maps).

## The drawer and the bottom bar {phone}

- **Drawer.** It lists your smart lists, projects, categories and labels. Hold and drag projects and labels to reorder them. **Settings, General, Drawer** hides the views you do not use.
- **Bottom bar.** The Inbox always stays first. **Settings, General, Bottom Bar** sets the other three slots to any smart list, project or custom list, with an icon and a color. **Smart list colours** draws the Inbox, Today, Upcoming and Anytime icons in their own colors. Plan can take a slot when it is on.
- **Left-handed add button.** **Settings, General, Preferences** can move the + button to the bottom-left corner.

## Look {phone}

- **Appearance** in **Settings, General**: **Theme** (System, Light or Dark) and **Task rows** (Compact or Comfortable).
- **Pure black.** A black background in the dark theme for OLED screens. It shows when the theme is not Light.
- **Use device colours.** {android} Follows your wallpaper's palette (Android 12 and later) instead of the Vicu colors.

## The connection banner

{phone} A neutral banner under the status bar says **Offline** or **Can't reach the server**, with the number of waiting changes. Airplane mode counts as offline. Nothing is lost: see [Sync and offline](guide:sync).

## Android and iOS differences

| Topic | Android | iPhone and iPad |
|---|---|---|
| Quick add entry points | Quick Settings tile, Quick add widget | Control Center, Lock Screen and Action Button control, Siri |
| Sharing | Opens the full task entry | A native sheet that adds to the Inbox |
| Reminders | Checked on the server when they ring | Up to 60 planned ahead |
| Background sync | About every 30 minutes | When iOS allows it. **Settings, General, Background activity** shows the last runs. |
| Pasting an image into notes | Supported | Use **Add image** instead |
| Device colors | Supported | Not available |
| Single sign-on | In-app window or your browser | An in-app web view. Some providers, Google among them, refuse it: choose **Sign in through your browser**, a password or an API token. |
| Voice | Android speech recognizer | Apple speech recognizer, and Siri |

## Related

- [Sync and offline](guide:sync)
- [Settings](guide:settings)
- [Add tasks](guide:capture)
- [Plan your day](guide:plan)
- [Quick add](guide:quick-add)
