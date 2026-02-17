# Vicu

A GTD-focused desktop task manager powered by [Vikunja](https://vikunja.io/).

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)
![Electron](https://img.shields.io/badge/electron-33-47848F)
![React](https://img.shields.io/badge/react-18-61DAFB)
![TypeScript](https://img.shields.io/badge/typescript-5-3178C6)

<img src="docs/screenshots/main-window.png" alt="Vicu main window" width="800"> <!-- screenshot: main-window -->

<p>
  <img src="docs/screenshots/quick-entry.png" alt="Quick Entry popup" width="380"> <!-- screenshot: quick-entry -->
  <img src="docs/screenshots/quick-view.png" alt="Quick View popup" width="380"> <!-- screenshot: quick-view -->
</p>

## Why Vicu?

Vicu is for people who use Vikunja as a personal task backend and want a desktop app that stays out of their way. Press a hotkey from any app to capture a thought. Glance at your task list without switching windows. Work through your day in a GTD flow that moves tasks through time -- inbox to today to done -- instead of across columns or boards. If you keep notes in Obsidian, Vicu bridges the two: link any note to any task with a keystroke, and jump back to it from anywhere in the app.

## How it works

Vicu organizes your tasks around time, not status. New tasks land in your **Inbox** -- a single capture bucket where you dump everything without deciding where it goes. When you process your inbox, you give tasks due dates, which moves them into **Upcoming** (future) or **Today** (now). **Anytime** shows your full open backlog for when you need something to do next. Finished tasks move to the **Logbook**. This is the GTD cycle: capture fast, schedule into time-based buckets, focus on today, review what's done.

## Key features

### Capture

- **Quick Entry** -- a global hotkey (`Alt+Shift+V`) opens a floating popup from any app. Type a task, pick a project, hit Enter. You never leave what you're doing.
- **Natural language dates** -- type "tomorrow", "next monday", or "in 3 days" and the due date is set automatically via chrono-node.
- **`!` for today** -- end your task title with `!` and the due date is set to today. One character, no date picker.
- **Project cycling** -- hold a modifier key and press arrow keys to cycle through your projects without opening a dropdown.

### Focus

- **Smart lists** -- Inbox, Today, Upcoming, Anytime, and Logbook map directly to GTD workflow stages. No configuration needed.
- **Custom Lists** -- create your own filtered views by project, due date range, priority, or label. They appear in the sidebar alongside smart lists.
- **Keyboard navigation** -- arrow keys to move between tasks, Enter to expand, Ctrl+N to create, Ctrl+K to complete. Quick View has its own keyboard-driven flow.

### Connect

- **Obsidian deep linking** -- when Quick Entry opens, it detects the active Obsidian note (via the Local REST API plugin). Press `Ctrl+L` to link that note to your task. Links use Advanced URI with frontmatter UIDs, so they survive note renames. Linked tasks show a clickable Obsidian icon everywhere in the app -- click it and the note opens. Three modes: "ask" (opt-in per task), "always" (auto-link every task), and "off".
- **Quick View** -- a second global hotkey (`Alt+Shift+B`) shows a floating task list. Check off tasks, edit inline, navigate with keys. Configurable to show any project, smart list, or custom list.
- **System tray** -- Vicu lives in your tray. The main window hides instead of closing, and Quick Entry / Quick View are always one click away.
- **Notifications** -- configurable daily reminders (morning and afternoon), plus per-task reminders synced from Vikunja. Overdue and due-today alerts keep tasks from slipping.
- **OIDC authentication** -- full OAuth2/OpenID Connect flow for Vikunja instances behind SSO, with silent token refresh and automatic backup API token creation.
- **Offline resilience** -- failed API calls are queued and retried when your server comes back. Tasks are cached locally so the app stays usable even when your Vikunja instance is unreachable.

## Vicu vs the official Vikunja app

The [official Vikunja frontend](https://vikunja.io/) is a comprehensive project management suite built for teams. It offers Kanban boards, Gantt charts, table views, task dependencies, file attachments, team sharing, and role-based permissions -- everything you'd expect from a full-featured work management tool.

Vicu is something different. It's a personal task manager that trades breadth for speed and focus. There's no Kanban, no Gantt, no collaboration -- by design. If you need those things, the official app is the right choice. If you want fast capture from anywhere, a GTD workflow that keeps you moving through your day, and deep Obsidian integration, Vicu is built for that.

Both apps talk to the same Vikunja backend, so you can use them side by side.

## Getting started

**Prerequisites**: Node.js 18+, a running [Vikunja](https://vikunja.io/docs/) instance (or use standalone mode for local-only tasks).

```bash
git clone https://github.com/rendyhd/Vicu.git
cd Vicu
npm install
npm run dev
```

On first launch, Vicu will ask you to connect to your Vikunja instance. Enter your server URL and either an API token or sign in via OIDC. Then pick which project to use as your Inbox, configure your global hotkeys, and you're set.

## Configuration

Settings are accessible from the sidebar. You can configure:

- **Connection** -- Vikunja URL, authentication method (API token or OIDC)
- **Theme** -- light, dark, or follow system
- **Quick Entry / Quick View** -- enable/disable, hotkeys, default project, secondary projects for cycling, Quick View filter settings
- **Notifications** -- daily reminder times, which categories to notify (overdue, due today, upcoming), sound and persistence
- **Obsidian** -- linking mode, API key, port, vault name
- **Standalone mode** -- local-only task storage without a Vikunja server

## Building from source

```bash
npm install          # Install dependencies
npm run dev          # Start in development mode with HMR
npm run build        # Production build
npm run package      # Package with Electron Forge
npm run make         # Create distributable installer
```

## See also

- [vikunja-quick-entry](https://github.com/rendyhd/vikunja-quick-entry) -- a lightweight standalone tray app for Quick Entry and Quick View only, without the full task management UI. The original companion app that Vicu grew out of.
- [Vikunja](https://vikunja.io/) -- the open-source task and project management backend that powers Vicu.

## License

[MIT](LICENSE)
