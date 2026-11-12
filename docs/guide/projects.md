---
title: Projects and labels
nav: Projects and labels
description: Organize tasks in Vicu with projects, subprojects, sections, categories and labels. Sort tasks, move projects, archive them and see progress at a glance.
lead: Projects hold related tasks, and labels tag tasks across projects. This page covers making, arranging, sorting and archiving them.
---

## In short

- **A project holds tasks**, and can hold subprojects and sections.
- **Categories** are optional headers that group your top-level projects.
- **Labels** tag tasks across projects. Each label has its own page.
- **The project menu** has every action: rename, edit, add a subproject, move, sort, share, archive and delete.
- **Drag** projects to nest or reorder them, and drag tasks onto a project or label to move or tag them.
- **Each project can have its own task order.**

## Make a project

### On the desktop {desktop}

1. Click **+** next to **Projects** in the sidebar.
2. Type a name in the new row and press <kbd>Enter</kbd>.

To add a subproject, open the project's menu and choose **Add subproject**. In **Settings, Projects**, **New project** does the same.

### On a phone {phone}

Tap **+** on the drawer's **Projects** header. To make a subproject, open the project, tap the **⋮** menu and choose **Add subproject**.

## The project menu

One menu holds the project actions, on every screen that shows a project.

- On the desktop, open it from the **...** button on a sidebar row, with a right-click, from the project page header, or from the rows in **Settings, Projects**. With a project focused, <kbd>Shift</kbd>+<kbd>F10</kbd> opens it. {desktop}
- On a phone, tap **⋮** on the project screen or on the rows in **Settings, Projects**. {phone}

| Action | What it does |
|---|---|
| **Rename** | Renames in place. <kbd>F2</kbd> works on a focused project on the desktop. |
| **Edit** | One dialog for name, parent, color and icon |
| **Add subproject** | Makes a project inside this one |
| **Move to** | Puts the project under another |
| **Move to category** | Moves a top-level project under a category header {desktop} |
| **Add category above** | Makes a new category above this project {desktop} |
| **Set as Inbox** | Makes this project your Inbox |
| **Review** | Marks it reviewed, and sets its review cadence or leaves it out of review |
| **Sort tasks** | Sets this project's task order |
| **Share** | Shares the project with people. See [Work with others](guide:collaboration) |
| **Archive** | Hides the project without deleting it |
| **Delete** | Deletes it. It asks first when **Confirm before deleting** is on. |

On a phone, the menu reads **Edit project**, **Add subproject**, **Set as Inbox**, **Mark reviewed**, **Archive**, **Delete** and **Sort tasks**. **Edit project** holds **Shared with**. {phone}

A project cannot be put inside the Inbox, and the Inbox cannot be archived.

### Colors and icons

**Edit** sets a project's color. The icon can be a folder or **None**. **None** suits names that start with an emoji, and it syncs. The sidebar, Settings and project pickers then leave the icon out so the name starts where it would.

## Move and reorder projects

### On the desktop {desktop}

Drag a project in the sidebar or in **Settings, Projects**:

- Drop on the middle of another project to nest it inside.
- Drop on the top third of a row to place it before, and on the bottom third to place it after.
- Drop on the **PROJECTS** header to make it top-level.

A move to another parent shows a message with **Undo**.

From the keyboard, focus a project and press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>Arrow</kbd> (<kbd>Option</kbd> on a Mac) to move it up, down, into the project above, or out one level.

### On a phone {phone}

Hold and drag a project within its level. Screen reader users get **Move up** and **Move down** actions.

## Categories

If you have many top-level projects, categories group them under named headers. They are optional. Without one, nothing changes.

- Choose **Add category above** in a project's menu, or **New category** in **Settings, Projects**, to make one and name it.
- Choose **Move to category** in a project's menu to file it. Or drag a project past a header.
- Use the header's menu to rename, move up, move down or delete a category. Deleting has **Undo**.
- Click a header to collapse it. That is remembered per device.

Categories sync to all your devices. Two people sharing a project each file it separately. Project pickers show the same headers.

Categories apply to top-level projects only.

## Sections

Sections split a project into collapsible groups with headers and counts. Add one from the project menu, or from the strip that shows **Add section** between sections. A group of one has no header. On a phone, collapsed sections are remembered while the app runs.

## Labels

A label is a colored tag with its own page. Chip text always stays readable against the label's color.

- Put labels on a task in its card, or type `@errand` in quick add. See [Quick add](guide:quick-add).
- Open a label from **Tags** in the sidebar, or **Labels** in the phone drawer, to see all its tasks.
- Drag a task onto a label in the sidebar to apply it. {desktop}
- On a phone, create labels from the picker. Tapping **Create** when a search finds nothing makes the label. Drag labels in the drawer to reorder them; the order stays on that device. {phone}

## Task order

A project's tasks are sorted in the project's order. The default is **Due date, then manual**: dated tasks first by date, then the rest in the order you drag them.

The choices are **Due date, then manual**, **Due date, then priority**, **Manual**, **Priority**, **Title**, **Newest first** and **Oldest first**.

### Set the order

- For one project, open its menu and choose **Sort tasks**. **Default** makes it follow its parent project again. The Inbox has a sort button in its header.
- For all projects, open **Settings, Projects, Display** and use **Sort project tasks by**. It shows how many projects have their own order, with **Reset**.

A subproject follows its parent's order unless it has one of its own. The order syncs, and phone widgets follow it.

### Drag to reorder

What you can drag depends on the order:

| Order | What you can drag |
|---|---|
| **Manual** | Every task |
| **Due date, then manual** | Tasks without a date, among themselves |
| Any other order | Nothing. A message says why. |

### Move a task from the keyboard {desktop}

Press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>Up</kbd> or <kbd>Down</kbd> on a focused task (<kbd>Option</kbd>+<kbd>Shift</kbd> on a Mac), or choose **Move up** or **Move down** in its menu. The same rule applies as for dragging. On a phone, **Move up** and **Move down** are screen reader actions. {phone}

## Progress rings and counts

Each project row can show a small ring of done and open tasks.

- **Show project progress in the sidebar** is on by default.
- **Show task count in the sidebar** adds the number of open tasks and is off until you turn it on. With both on, a row shows the ring and then the count.

Both are in **Settings, Projects, Display**, per device. Hidden tasks, such as the ones Vicu uses for routines, never count.

## Archive and restore

Archiving hides a project but keeps it. Archived projects collect in an **Archived** group in the sidebar. Choose **Restore** on one, or **Restore project** on its page, to bring it back. An archived project's menu also has **Delete**.

## Saved filters

If you used saved filters in Vikunja, Vicu turns them into custom lists. See [Custom lists](guide:custom-lists#vikunja-saved-filters).

## Related

- [How Vicu is organized](guide:basics)
- [Smart lists](guide:lists)
- [Custom lists](guide:custom-lists)
- [Work with others](guide:collaboration)
- [Review and guided organizing](guide:review)
