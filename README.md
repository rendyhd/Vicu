# Vicu

A personal task manager for your desktop, powered by [Vikunja](https://vikunja.io/).

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)
![Built with](https://img.shields.io/badge/electron%20+%20react%20+%20typescript-47848F)

<!-- screenshot: main-window -->

## What is Vicu?

Vicu turns Vikunja into a fast, keyboard-driven task manager that lives on your desktop. Press a hotkey from any app to capture a task in two seconds — you never leave what you're doing. Press another hotkey to check your list. Everything is organized around when things need to happen: tasks land in your **Inbox**, get scheduled into **Today** or **Upcoming**, sit in **Anytime** as your open backlog, and end up in the **Logbook** when done. No Kanban boards, no Gantt charts, no team features — just a simple flow from "I need to do this" to "it's done."

If you work in Obsidian, Vicu bridges your notes and your tasks: link the active note to a task with a keystroke, and jump back to it from anywhere in the app.

<!-- screenshots: quick-entry, quick-view side by side -->

## Capture from anywhere

**Quick Entry** is Vicu's defining feature. Press `Alt+Shift+V` from any app and a floating popup appears. Type your task, set a date, pick a project, hit Enter — it's captured and the popup is gone. You stay in flow.

Dates are flexible: type "tomorrow" or "next friday" for natural language scheduling, or just end the title with `!` to set it due today. Hold a modifier key and press arrow keys to cycle through projects without opening a dropdown.

Quick Entry was originally a standalone companion app ([vikunja-quick-entry](https://github.com/rendyhd/vikunja-quick-entry)) that has been integrated directly into Vicu.

## Review without switching

**Quick View** (`Alt+Shift+B`) is Quick Entry's counterpart: a floating task list you can summon from anywhere. Check off tasks, edit inline, navigate with arrow keys, then dismiss it. Point it at any project, smart list, or custom list from settings.

## Obsidian integration

Vicu has first-class support for linking Obsidian notes to tasks. When Quick Entry opens, it detects your active note via the Local REST API plugin. Press `Ctrl+L` to attach it — the link uses Advanced URI with frontmatter UIDs, so it survives note renames. Linked tasks show a clickable Obsidian icon throughout the app: in task lists, in Quick View, everywhere. Click it and the note opens.

Three modes: **ask** (Ctrl+L to opt-in per task), **always** (auto-link), and **off** (zero overhead).

## Browser integration

Vicu can link tasks to your active browser tab. A bundled Manifest V3 extension (Chrome and Firefox) sends the tab title and URL to Quick Entry via native messaging. When the extension isn't installed, Vicu falls back to Windows UI Automation to read the URL bar from Chrome, Firefox, Edge, and Brave.

Same three modes as Obsidian: **ask** (`Ctrl+L`), **always**, and **off**.

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

The [official Vikunja frontend](https://vikunja.io/) is a full project management suite — Kanban, Gantt, table views, team collaboration, dependencies, and more. Vicu is a personal task manager that trades all of that for speed and a simple workflow. Both talk to the same backend, so you can use them side by side.

## Getting started

### Download

Grab the latest Windows installer from [GitHub Releases](https://github.com/rendyhd/Vicu/releases).

### Build from source

You'll need Node.js 20+ and a running [Vikunja](https://vikunja.io/docs/) instance.

```bash
git clone https://github.com/rendyhd/Vicu.git
cd Vicu
npm install
npm run dev
```

On first launch, connect to your Vikunja instance, pick your Inbox project, and configure your hotkeys. For Obsidian integration, enable the Local REST API and Advanced URI plugins, then set your API key in Vicu's settings.

## Building

```bash
npm run build        # Production build
npm run dist         # Build + create Windows NSIS installer
```

## See also

- **[vikunja-quick-entry](https://github.com/rendyhd/vikunja-quick-entry)** — lightweight tray app for Quick Entry and Quick View only, without the full UI
- **[Vikunja](https://vikunja.io/)** — the open-source backend that powers Vicu

## License

[MIT](LICENSE)
