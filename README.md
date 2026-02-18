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

## Features

Vicu also includes smart lists (Inbox, Today, Upcoming, Anytime, Logbook), custom filtered lists, subtasks, tags and labels, drag-and-drop for reordering and organizing, dark/light/system themes, native notifications with configurable daily reminders, offline task caching with automatic retry, OIDC/SSO authentication, and system tray integration with launch-on-startup.

## Vicu vs the official Vikunja app

The [official Vikunja frontend](https://vikunja.io/) is a full project management suite — Kanban, Gantt, table views, team collaboration, dependencies, and more. Vicu is a personal task manager that trades all of that for speed and a simple workflow. Both talk to the same backend, so you can use them side by side.

## Getting started

You'll need Node.js 18+ and a running [Vikunja](https://vikunja.io/docs/) instance.

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
npm run package      # Package with Electron Forge
npm run make         # Create distributable installer
```

## See also

- **[vikunja-quick-entry](https://github.com/rendyhd/vikunja-quick-entry)** — lightweight tray app for Quick Entry and Quick View only, without the full UI
- **[Vikunja](https://vikunja.io/)** — the open-source backend that powers Vicu

## License

[MIT](LICENSE)
