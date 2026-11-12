---
title: Vicu on the desktop
nav: On the desktop
description: What the desktop app adds on Windows, macOS and Linux: Quick Entry, Quick View, the command palette, Quick find, the tray, startup options and browser or Obsidian links.
lead: The desktop app is the full Vicu, plus a few things that only a computer can do: a task box you can call up over any app, a small list you can check off without switching windows, and a command palette.
---

## In short

- **Quick Entry and Quick View are off until you turn them on** in **Settings, Quick Entry / View**. Each has its own shortcut that works in any app.
- **The command palette** ({desktop}) opens with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> (<kbd>Cmd</kbd> on a Mac). It jumps to any list, project, label or task and runs actions.
- **Quick find** is the search box at the top of the sidebar. <kbd>Ctrl</kbd>+<kbd>F</kbd> puts the cursor there.
- **The tray icon** appears while Quick Entry or Quick View is on. Closing the window then hides Vicu instead of quitting it.
- **F5 refreshes** the page you are on from your server.
- **Browser and Obsidian links** attach the page or note you were looking at to a new task.

## Quick Entry

{desktop}

Quick Entry is a small box that opens over whatever you are doing. Type a task, press <kbd>Enter</kbd>, and it is gone. It uses [quick add](guide:quick-add), so dates, labels, projects and priority typed in the title are read as you type.

![Quick Entry over another app](screen:desktop-quick-entry.webp "Quick Entry")

### Turn it on

:::steps
1. Open **Settings, Quick Entry / View**.
2. Tick **Enable Quick Entry**.
3. Check the hotkey. The default is <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>, and <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> on a Mac. Click it to record another.
4. Pick a **Default Project**. New tasks land there.
:::

### Use it

- Type the task and press <kbd>Enter</kbd>. <kbd>Esc</kbd> closes the box without saving.
- Press <kbd>Tab</kbd> to add a description under the title.
- Hold the project cycle modifier (<kbd>Ctrl</kbd> by default) and press <kbd>Left</kbd> or <kbd>Right</kbd> to switch to another project. The box says "saving to" with the project's name. Add the projects to cycle through under **Secondary Projects**, and pick the modifier under **Project Cycle Modifier**.
- Press <kbd>Ctrl</kbd>+<kbd>L</kbd> (<kbd>Cmd</kbd>+<kbd>L</kbd> on a Mac) to link the page or note you were looking at. See [Browser and Obsidian links](guide:desktop#browser-and-obsidian-links).
- It works offline. The task waits in the [offline queue](guide:sync#the-offline-queue) and goes to the server when you are back.

## Quick View

{desktop}

Quick View is a short list in a floating window. Use it to check what is next and tick things off without leaving the app you are in.

![Quick View](screen:desktop-quick-view.webp "Quick View")

1. Open **Settings, Quick Entry / View** and tick **Enable Quick View**.
2. Under **List**, choose what it shows: **All projects**, Today, Upcoming, Anytime, one project, or one of your [custom lists](guide:custom-lists). You can also tick **Include tasks due today from all projects**.
3. Press the hotkey: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> by default, <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> on a Mac.

Inside the window:

| Key | What it does |
|---|---|
| <kbd>Up</kbd> and <kbd>Down</kbd> | Move through the tasks |
| <kbd>Enter</kbd> | Complete the selected task. Press it again to undo. |
| <kbd>Tab</kbd> | Show or hide the task's description |
| <kbd>Shift</kbd>+<kbd>Enter</kbd> | Edit the title and description |
| <kbd>!</kbd> | Set the due date to today, or remove it if there is one |
| <kbd>Esc</kbd> | Close the window |

Quick View follows your theme, picks up changes you make in the main window, and applies the conditions of a custom list.

## Global shortcuts and Wayland

{desktop}

The Quick Entry and Quick View shortcuts work in any app. If another program already uses a key combination, Settings says it could not register the shortcut. Record a different one.

> [!NOTE]
> **On Linux with Wayland,** apps cannot grab keys on their own. Vicu asks the desktop through the GlobalShortcuts portal. If a consent dialog appears, accept it and try again. If it still fails, Settings shows a command for each window. Add it as a custom shortcut in your desktop's keyboard settings (GNOME: **Settings, Keyboard, Custom Shortcuts**; KDE: **System Settings, Shortcuts, Custom Shortcuts**) and keep Vicu running in the tray. The shortcut then wakes the running copy.

## The tray, startup and the window

- **Tray icon.** It exists while Quick Entry or Quick View is on. Click it to show Vicu, or right-click for **Show Vicu**, **Quick Entry**, **Quick View** and **Quit**. On macOS the menu opens with a single click.
- **Closing the window.** With a tray icon (or on a Mac), the close button hides Vicu and keeps it running so the shortcuts stay ready. Choose **Quit** from the tray, or **File, Quit** on Windows and Linux, to end it.
- **Launch on startup.** **Settings, General, Preferences, Launch on startup** starts Vicu when you sign in. It is advised if you use Quick Entry or Quick View.
- **Start hidden.** With launch on startup ticked, **Start hidden** opens Vicu without a window. It needs the tray icon (turned on through Quick Entry or Quick View) or a Mac, so there is a way back to the window.
- **Linux.** The AppImage writes an autostart entry. The option is hidden when Vicu cannot tell which file to start, for example in a development build. On GNOME the tray icon needs the AppIndicator extension.
- **Updates.** Vicu checks for a new version every 12 hours and tells you.

### How the window looks on each system

| System | Window |
|---|---|
| Windows 11 | Native minimize, maximize and close buttons with Snap Layouts, and a translucent Mica sidebar (version 22H2 and later) |
| Windows 10 | The same native buttons and an opaque sidebar |
| macOS | The usual traffic-light buttons and a translucent sidebar |
| Linux | Vicu draws its own window buttons |

## The command palette

{desktop}

![The command palette](screen:desktop-palette.webp "The command palette")

Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> on a Mac) and type. One field finds tasks, projects, labels and lists, and runs actions. Use <kbd>Up</kbd> and <kbd>Down</kbd> to choose, <kbd>Enter</kbd> to run, <kbd>Esc</kbd> to close.

Actions include **New task**, **Say a task**, **Refresh**, **Toggle theme** and **Settings**. When the matching feature is on, you also find **New event**, **Dictate tasks**, **Brain dump**, **Ask Vicu**, **Make tasks from text**, and the guided sessions **Sort the Inbox**, **Sort out overdue**, **Waiting a long time**, **Start review** and **Weekly review**.

A smart list you hid from the sidebar still opens from the palette.

## Quick find

{desktop}

The **Quick find** box sits at the top of the sidebar. Press <kbd>Ctrl</kbd>+<kbd>F</kbd> (<kbd>Cmd</kbd>+<kbd>F</kbd>) to jump to it. Tasks that match show as you type. The last row, "Search all tasks for ...", opens the full Search page, which also finds notes and finished tasks and has filters for date, status, labels and priority.

## Refresh

{desktop}

<kbd>F5</kbd> or <kbd>Ctrl</kbd>+<kbd>R</kbd> (<kbd>Cmd</kbd>+<kbd>R</kbd>) reads the page you are on again from your server. It also refreshes projects, labels, sharing, custom lists and synced settings, and it sends waiting changes first. **View, Reload window** (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>) reloads the whole window instead.

## Right-click text menu

{desktop}

Right-click in any text field for spelling suggestions, **Cut**, **Copy**, **Paste** and **Select all**. On selected text that you cannot edit, you get **Copy**. A task row has its own right-click menu.

## Browser and Obsidian links

{desktop}

Both work from Quick Entry. In **Settings, Quick Entry / View**, set **Page Linking** (browser) or **Note Linking** (Obsidian) to **Off**, **Ask** or **Always auto-link**. With **Ask**, press <kbd>Ctrl</kbd>+<kbd>L</kbd> in Quick Entry to attach the link.

- **Browser.** Vicu reads the address of the active browser tab. A bundled extension for Chrome, Edge, Brave, Vivaldi, Opera or Firefox makes it instant. Without it, Vicu reads the address bar, which takes a moment. Under **Browser Integration**, paste a Chrome Extension ID if you installed it, and use **Re-register Bridge** if the link stops working. On a Mac the first use asks you to let Vicu control the browser. On Linux only the extension works, because the desktop does not let apps look at other windows.
- **Obsidian.** Vicu links the note you have open. It needs two Obsidian plugins, Local REST API and Advanced URI, and you enter the **API Key**, **Vault Name** and **Port** under **Obsidian Integration**. Use **Test Connection** to check. Obsidian links are not available on Linux, and the settings are hidden there.

Both sections are greyed out until Quick Entry is on.

## Links into Vicu

Other apps and scripts can open Vicu with a `vicu://` link. See [Vicu Pro](guide:pro) for the list of links.

## Related

- [Quick add](guide:quick-add)
- [Keyboard shortcuts](guide:shortcuts)
- [Settings](guide:settings)
- [Sync and offline](guide:sync)
- [Add tasks](guide:capture)
