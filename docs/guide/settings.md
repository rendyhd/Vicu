---
title: Settings
description: Every setting in the Vicu desktop and phone apps, what it does, and whether it follows you to your other devices or stays on one.
lead: A reference to each settings section on the desktop and on the phone. Every table says which settings are synced through your server and which stay on the device where you set them.
---

## In short

- **Open Settings** from the sidebar (desktop) or the drawer (phone). The desktop has tabs: **General**, **Projects**, **Quick Entry / View**, **Notifications**, **Assistant**, **Pro** and **Keyboard Shortcuts**. The phone has **General**, **Projects**, **Notifications**, **Gestures** and **Assistant**.
- **Most settings are per device.** Look, behavior, notification and shortcut choices stay on the device where you set them. Setting the theme on your phone does not change your computer.
- **Some settings are synced.** They live on your server and appear on every device you sign in on: your Inbox, task order, custom lists, categories, templates, planner defaults, and a few more. Tables below mark them **Synced**.
- **Settings save as you change them.** There is no Save button.
- **Only a few shortcuts can be changed.** See [Keyboard shortcuts](guide:shortcuts).

How to read the tables: **Synced** follows you to every device. **This device** stays where you set it.

## Desktop {desktop}

### General

#### Connection

| Setting | What it does | Follows you |
|---|---|---|
| Vikunja URL | The server Vicu talks to. Shown, not editable, when you signed in with a password or single sign-on. | This device |
| Sign Out | Signs out. First sends what is waiting and asks if anything has not reached the server. | This device |
| API Token and Test Connection | Only when you signed in with a token. Paste a new one to replace it. **Disconnect** removes it. | This device |

#### Appearance

| Setting | What it does | Follows you |
|---|---|---|
| Theme | Light, dark or system | This device |
| Clock | System, 12-hour or 24-hour | This device |
| Task rows | **Compact** (one title line) or **Comfortable** (up to three title lines and a line of notes) | This device |

#### Preferences

| Setting | What it does | Follows you |
|---|---|---|
| Launch on startup | Starts Vicu when you sign in to your computer | This device |
| Start hidden | Starts without a window. Needs the tray icon. | This device |
| Confirm before deleting | Asks before deleting tasks, projects, labels and lists | This device |
| Subtasks in task lists | **Inside task** keeps them in the task, **Expandable** shows them under the parent | This device |
| Show today & overdue count on app icon | A badge with the number of tasks due today and overdue | This device |
| What does urgent mean? | **Schedule for Today** or **Mark Important**: what the top action in a task's right-click menu does | This device |

#### Plan

Shown unless you use standalone mode. See [Plan your day](guide:plan) and [Events and calendars](guide:calendars).

| Setting | What it does | Follows you |
|---|---|---|
| Show Plan in the sidebar | Turns the Plan screen on. Off by default. A time you set on a task shows on every device either way. | This device |
| Default length | What a task takes when you drop it on a time | Synced |
| Work hours | Start and end of your day, used for free time, Fit and Plan my day | Synced |
| Ask me to plan tomorrow | An evening notification at the time you choose | This device |
| Show routines on the timeline | Routine pills on Plan | This device |
| Calendars | Connected calendars, their colors, Busy only, and **Import a calendar file** | This device |

#### Sidebar

Tick the smart lists you want above your projects. The Inbox always stays. A hidden list still opens from the [command palette](guide:desktop#the-command-palette). This choice is per computer.

#### Task Completion Sound

A sound when you complete a task. Pick a file (MP3, WAV, OGG, M4A, AAC or FLAC, up to 10 MB), use **Play** to hear it, or reset to the default. **This device.**

#### Routines

| Setting | What it does | Follows you |
|---|---|---|
| Enable routines | Off hides Routines, its Today section and its reminders. Nothing is deleted. | This device |
| Show routines in Today | Lists the routines still open today | This device |
| Routines shown on Today | How many due routines show: 1, 2 (the default), 3, 5 or all. The rest wait behind a line such as "2 later today". | This device |
| Hidden shared routines | Routines someone shared that you hid, with a way to show them again | Synced |

See [Routines](guide:routines).

#### Task Parser

| Setting | What it does | Follows you |
|---|---|---|
| Parse task metadata from text | Reads labels, projects, priority, dates and repeats from what you type. Off makes the title plain text. | This device |
| Syntax Mode | **Todoist** style (`#project`, `@label`, `p1`) or **Vikunja** style (`+project`, `*label`, `!1`) | This device |
| `!` in task title sets due date to today | A lone `!` before or after a title means due today | This device |

See [Quick add](guide:quick-add).

### Projects

| Setting | What it does | Follows you |
|---|---|---|
| Inbox project | Where new tasks land. Setup suggests the one another device already chose. | Synced |
| Project list | Your projects and categories, with **New project** and **New category**, drag to reorder, and each project's menu | Synced |
| Sort project tasks by | The global order: Due date then manual, Due date then priority, Manual, Priority, Title, Newest first, Oldest first. A project can have its own. | Synced |
| Show project progress in the sidebar | A ring per project | This device |
| Show task count in the sidebar | Open tasks per project. Off until you turn it on. | This device |
| Enable project review tracking | Turns the review list on | This device |
| Default review cadence (days) | How often projects are due for review. 14 to start. | This device |
| Exclude Inbox from review list | Leaves the Inbox out | This device |
| Excluded from review | Projects you left out, with **Include again** | Synced (stored with the project) |
| Import saved filters | Turns your Vikunja saved filters into custom lists | Synced (the lists) |

See [Projects and labels](guide:projects), [Custom lists](guide:custom-lists) and [Review and guided organizing](guide:review).

### Quick Entry / View

All of these are **This device**. See [On the desktop](guide:desktop).

| Setting | What it does |
|---|---|
| Enable Quick Entry, Enable Quick View | Each is off until you turn it on |
| Hotkey (Quick Entry) | Default <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>, <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> on a Mac |
| Default Project | Where Quick Entry saves |
| Secondary Projects, Project Cycle Modifier | The projects you can switch to, and the key that does it |
| Hotkey (Quick View) | Default <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>, <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> on a Mac |
| List | What Quick View shows |
| Include tasks due today from all projects | Adds today's tasks from every project |
| Browser Integration | **Page Linking**, Chrome Extension ID, **Re-register Bridge** |
| Obsidian Integration | **Note Linking**, API Key, Vault Name, Port, **Test Connection**. Not on Linux. |

### Notifications

All **This device**, except the list of places.

| Setting | What it does |
|---|---|
| Enable desktop notifications | The master switch. On a Mac, the first notification asks for permission. |
| Scheduled Reminders | A **Morning reminder** and an **Afternoon reminder** with a time each. Include **Overdue tasks**, **Tasks due today**, **Tasks due tomorrow**. **Play sound** and **Stay until dismissed**. |
| Task Reminders | **Play sound** and **Stay until dismissed** for reminders you set on tasks |
| Default reminder | Added to every new task that has a due date and no reminder. Relative to the due, start or end date. Never added to existing tasks. |
| Test Notification | Sends a test |
| Places | The places you saved on your phone, read only. Synced. |

### Assistant

All **This device**: the assistant's provider, key and models do not sync. See [The assistant](guide:assistant).

| Section | What it holds |
|---|---|
| Thinking | **Provider** (OpenAI, Anthropic, Google Gemini, OpenRouter, Ollama, Open WebUI or another compatible server), address, key, **Model**, and **Use a different model for Ask** |
| Features | Switches for **Smart dictation**, **Brain dump**, **Ask** and **Talk**, each with **Try it** |
| Hearing | Speech models to download so voice is recognized on your computer, and the **Language** |
| Privacy | **Delete conversations** |

### Pro

Turn Pro on for this device, choose its parts, and set **Assistant help in Pro**. Those choices are per device. The work area, the cap on active initiatives and the escalation rule are synced. See [Vicu Pro](guide:pro).

### Keyboard Shortcuts

Shows the shortcut list, and the **Voice input** shortcut (**This device**, off until you record one). See [Keyboard shortcuts](guide:shortcuts).

## Phone {phone}

Settings are in the drawer. Everything on the phone is per device unless marked.

### General

| Section | What it holds | Follows you |
|---|---|---|
| Account | Username, email, auth method, server, **Sign Out** | This device |
| Appearance | **Theme** (System, Light, Dark), **Pure black**, **Use device colours** ({android} only), **Task rows** (Compact or Comfortable) | This device |
| Bottom Bar | The last three slots, **Smart list colours**, **Reset to Defaults** | This device |
| Plan | **Show Plan in the drawer**, and the Plan options (default length and work hours sync, the evening nudge does not) | Switch: this device. Length and hours: Synced |
| Pro | **Turn on Pro on this device** and its parts | This device |
| Drawer | Which views the drawer lists | This device |
| Widget | **Smart add button**, **Context navigation** | This device |
| Routines | **Enable routines**, **Show routines in Today**, **Routines shown on Today**, **Hidden shared routines** | This device. Hidden shared routines: Synced |
| Logbook | **Hide old completed tasks** and **Keep completed tasks for** a number of days. Nothing is deleted. | This device |
| Input Parsing | **Natural Language Parsing**, **Syntax Mode** (Todoist or Vikunja), and "Add ! to set the due date to today" | This device |
| Preferences | **Confirm before deleting**, **Subtasks in task lists**, **Keep add-task open**, **Left-handed add button**, **Play sound when completing a task** | This device |
| Data & Sync | Status, **Sync Now**, **Retry All**, **Clear Failed**, **Clear Cache & Re-sync**, **Background activity** ({ios}) | n/a |

### Projects

| Section | What it holds | Follows you |
|---|---|---|
| Inbox Project | **Choose inbox project**, and **Move dated tasks out of Inbox** | Inbox: Synced. The move option: This device |
| Display | **Task order** (and **Sort tasks** per project), **Subprojects in project views**, **Show project progress**, **Show task count** | Order: Synced. The rest: This device |
| Review | **Enable project review tracking**, **Default review cadence**, **Exclude Inbox from review**, and the list of excluded projects | This device |
| Projects, Labels | Your projects (tap to edit, hold to drag, ⋮ for more) and labels | Synced |
| Custom Lists | Your custom lists, and the import of saved filters | Synced |

### Notifications

See [Vicu on your phone](guide:phone#notifications). **This device**: **Task Reminders**, **Sound**, **Daily Summary** and its times and counts, **Default Reminder**, **Send Test Notification**, the **Quick Add tile** ({android}) or **Add task control** hint ({ios}). **Places** sync by name, and positions stay on the phone.

### Gestures

**Swipe Right** and **Swipe Left**, each set to one action. **This device.**

### Assistant

Provider, key, models, features and speech models. **This device.** Parakeet is the suggested speech model on phones. Downloads wait for Wi-Fi unless you allow mobile data.

## Accessibility

Vicu follows your system's accessibility settings; there is nothing to turn on in Vicu.

- **Keyboard** {desktop}: everything works from the keyboard. Lists move with the arrow keys, menus and
  pickers jump to an item as you type its name, and one focus ring shows where you are. See
  [Keyboard shortcuts](guide:shortcuts).
- **Screen readers** {all}: menus, dialogs and lists are real controls with names, and changes such as
  "Completed" are announced. On the phone, every task row has screen reader actions, such as Complete, Due
  today and Due tomorrow.
- **Less motion** {all}: when your system asks for reduced motion, Vicu replaces movement with simple
  fades. On Windows that is **Settings, Accessibility, Visual effects, Animation effects**.
- **Contrast themes** {desktop}: with a Windows contrast theme, Vicu uses the system's colors and keeps
  every meaning visible by shape or text, not color alone. Priority, for example, is shown by bars and a
  mark, not only by color.
- **Text size** {ios}: Vicu follows Dynamic Type.

## Settings that always sync

For quick reference, these follow your account to every device:

- The Inbox project
- Task order, global and per project, and subtask order
- Custom lists and imported saved filters
- Project categories and icons
- Task templates
- Plan default length and work hours
- Your own Events
- Saved place names and location reminders
- Hidden shared routines and routine reminder choices
- The date of your last weekly review
- Pro's work area, cap and escalation rule, and Pro data

Everything else stays on the device. [Sync and offline](guide:sync) explains how this works.

## Related

- [Sync and offline](guide:sync)
- [Keyboard shortcuts](guide:shortcuts)
- [Quick add](guide:quick-add)
- [On the desktop](guide:desktop)
- [On your phone](guide:phone)
