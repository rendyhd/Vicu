# Vicu

A personal task manager for your desktop, powered by [Vikunja](https://vikunja.io/).

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey)
![Built with](https://img.shields.io/badge/electron%20+%20react%20+%20typescript-47848F)

<p align="center">
  <img width="2260" height="1000" src="https://github.com/user-attachments/assets/6d70e449-0339-45cd-8616-42524476ee86">
</p>

## What is Vicu?

Vicu turns Vikunja into a fast, keyboard-driven task manager that lives on your desktop. Press a hotkey from any app to capture a task in two seconds — you never leave what you're doing. Press another hotkey to check your list. Everything is organized around when things need to happen: tasks land in your **Inbox**, get scheduled into **Today** or **Upcoming**, sit in **Anytime** as your open backlog, and end up in the **Logbook** when done. No Kanban boards, no Gantt charts, no team features — just a simple flow from "I need to do this" to "it's done."

If you work in Obsidian, Vicu bridges your notes and your tasks: link the active note to a task with a keystroke, and jump back to it from anywhere in the app.

<p align="center">
  <img width="2260" height="1000" src="https://github.com/user-attachments/assets/87c36829-f7d9-458a-b5f4-9cfaca1053af">
</p>

## Capture from anywhere

**Quick Entry** is Vicu's defining feature. Press `Alt+Shift+V` from any app and a floating popup appears. Type your task, set a date, pick a project, hit Enter — it's captured and the popup is gone. You stay in flow.

Just end the title with `!` to set it due today. Hold a modifier key and press arrow keys to cycle through projects without opening a dropdown.

Quick Entry was originally a standalone companion app ([vikunja-quick-entry](https://github.com/rendyhd/vikunja-quick-entry)) that has been integrated directly into Vicu.

## Review without switching

**Quick View** (`Alt+Shift+B`) is Quick Entry's counterpart: a floating task list you can summon from anywhere. Check off tasks, edit inline, navigate with arrow keys, then dismiss it. Point it at any project, smart list, or custom list from settings.

## Obsidian integration

Vicu has first-class support for linking Obsidian notes to tasks. When Quick Entry opens, it detects your active note via the Local REST API plugin. Press `Ctrl+L` to attach it — the link uses Advanced URI with frontmatter UIDs, so it survives note renames. Linked tasks show a clickable Obsidian icon throughout the app: in task lists, in Quick View, everywhere. Click it and the note opens.

Three modes: **ask** (Ctrl+L to opt-in per task), **always** (auto-link), and **off** (zero overhead).

## Browser integration

Vicu can link tasks to your active browser tab. A bundled Manifest V3 extension (Chrome and Firefox) sends the tab title and URL to Quick Entry via native messaging. When the extension isn't installed, Vicu falls back to Windows UI Automation to read the URL bar from Chrome, Firefox, Edge, and Brave.

Same three modes as Obsidian: **ask** (`Ctrl+L`), **always**, and **off**.

## Natural language input

Type tasks the way you think. Vicu parses freeform text into structured fields as you type, with real-time highlighting and autocomplete.

| Token | Example | Effect |
|-------|---------|--------|
| Dates | `tomorrow`, `next Monday`, `Dec 25`, `in 3 days` | Sets due date |
| `!` | `Buy milk !` | Due today |
| Priority | `p1`–`p4`, `!urgent`, `!high`, `!medium`, `!low` | Sets priority |
| Labels | `@shopping`, `@"grocery list"` | Applies labels |
| Projects | `#work`, `#"side project"` | Assigns to project |
| Recurrence | `every 3 days`, `weekly`, `monthly` | Sets repeat interval |

Everything that isn't a recognized token becomes the task title. Tokens can appear anywhere in the input and are shown as dismissible chips below the text field.

Two syntax modes are available in Settings: **Todoist** (default — `@` for labels, `#` for projects) and **Vikunja** (`*` for labels, `+` for projects).

## Features

- **Smart lists** — Inbox, Today, Upcoming, Anytime, Logbook
- **Custom lists** — User-defined filtered views by project, due date, priority, labels, and sort order
- **Subtasks** — Parent-child task relationships
- **Tags and labels** — With custom colors, drag a task to a sidebar label to apply it
- **Recurring tasks** — Daily, weekly, monthly, or custom intervals
- **File attachments** — Drag-and-drop or browse to attach files to tasks
- **Reminders** — Per-task reminders (absolute or relative to due/start/end date), configurable daily and secondary reminders, overdue and upcoming notifications
- **Drag-and-drop** — Reorder tasks, projects, and custom lists; drag tasks to labels
- **Dark / light / system themes**
- **Offline caching** — Caches last fetch, queues failed actions for automatic retry
- **System tray** — Launch on startup, quick access to all windows
- **Authentication** — API token, username/password with TOTP two-factor and JWT auto-renewal, or OpenID Connect (OIDC/SSO) with provider discovery and silent re-auth

## Vicu vs the official Vikunja app

The [official Vikunja frontend](https://vikunja.io/) is a full project management suite — Kanban, Gantt, table views, team collaboration, dependencies, and more. Vicu is a personal task manager that trades all of that for simplicity. Both talk to the same backend, so you can use them side by side.

## Getting started

### Download

| Platform | Format |
|----------|--------|
| Windows  | `.exe` (NSIS installer) |
| macOS    | `.dmg` (Apple Silicon) |

Grab the latest installer from [GitHub Releases](https://github.com/rendyhd/Vicu/releases).

### macOS — first launch (unsigned app)

This app is not signed with an Apple Developer certificate. macOS will block it on first launch.

**Option A** — Open **System Settings → Privacy & Security**, scroll to the Security section, and click **Open Anyway** next to the blocked app message.

**Option B** — Run once in Terminal:

```bash
xattr -cr /Applications/Vicu.app
```

Either method is a one-time step. The app opens normally after that.

### Setup

1. Launch the app
2. Enter your Vikunja server URL (e.g. `https://app.vikunja.cloud`)
3. Authenticate with an API token, username/password, or OpenID Connect
4. Pick a project to use as your **Inbox**
5. Configure global hotkeys for Quick Entry and Quick View in Settings

## See also

- **[Vicu Android](https://github.com/rendyhd/Vicu-Android)** - Android version of Vicu
- **[vikunja-quick-entry](https://github.com/rendyhd/vikunja-quick-entry)** — lightweight tray app for Quick Entry and Quick View only, without the full UI
- **[Vikunja](https://vikunja.io/)** — the open-source backend that powers Vicu

## License

[MIT](LICENSE)
