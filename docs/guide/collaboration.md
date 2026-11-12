---
title: Sharing, assignees and comments
nav: Collaboration
description: Share a project with other people on your Vikunja server, assign tasks, write comments with mentions and files, and build lists for shared work.
lead: When other people can see a project, Vicu adds assignees, comment unread marks, mentions and more. Everything here needs people with accounts on the same Vikunja server.
---

## In short

- **Share a whole project**, not single tasks. Pick a person and choose **Can view**, **Can edit** or **Admin**. Only an admin of the project can share it.
- **Assign tasks** to the people in a shared project. They get Vikunja's own notification.
- **Every task has comments**, even in a private project, where they work as notes to yourself.
- **What involves other people shows only where it matters.** On a project only you can see, you do not see assignees, mentions, Notify me or unread marks.
- **Comments and assignments work offline.** They wait in the queue and send in order.
- You and the people you share with all need an account on the **same Vikunja server**.

## Share a project {all}

:::steps
1. Open the project's menu and choose **Share** (desktop), or open the project, choose the **⋮** menu, **Edit project** and **Shared with** (phone).
2. Type a **Username**.
3. Pick the **Permission**: **Can view**, **Can edit** or **Admin**.
4. Add the person. Change or remove anyone from the same list.
:::

Rules:

- Only an admin of the project sees **Share**.
- Sharing a project also gives access to its subprojects.
- Names and emails only match people who made themselves findable in Vikunja.
- A removal has Undo on the desktop, in the dialog.
- Teams are managed in Vikunja. Their members show in the list but you cannot change the team from Vicu.

A shared project gets a people icon in the sidebar.

## Assign a task {all}

In a shared project, a task has an **Assign** chip right after the project. Pick people from the list. Rows show who is assigned, you first. Vikunja notifies the person.

- People who can only view are shown as "Can view only" and cannot be picked.
- Assign and unassign work offline and send when the connection is back.

### Assign several tasks at once {all}

Select two or more tasks that all sit in shared projects you can edit. **Assign** appears in the selection bar and in the right-click menu on the desktop, and as **Assign...** in the selection's menu on the phone. A person is ticked when everyone has them, partly ticked when only some do. Picking someone adds them where they are missing. Picking a ticked person removes them from all.

## Comments {all}

Every task has **Comments**. The count shows on the row, with a dot when there are comments you have not read.

### Open the comments

- **Desktop:** click the count, use the **Comments** button on the open task, or press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> (<kbd>Cmd</kbd> on a Mac). The pane opens beside the list and stays open as you move between tasks until you close it.
- **Phone:** open the task and tap **Comments**.

The pane says who can read the thread. Post with <kbd>Ctrl</kbd>+<kbd>Enter</kbd> on the desktop. You can edit and delete your own comments (hold a comment on the phone). Someone who can only view the project can read but not write.

Opening a thread marks it read on all your devices.

### Mention someone

Type `@` and pick a name. They get a notification.

### Add files {desktop} {phone}

Attach files to a comment with the paperclip, by pasting or by dropping them (desktop). On the phone, use attach, or paste an image.

- Images show in the thread at a preview size and open in the viewer. Other files show as a row with **Open**, **Save** and, on the phone, Share.
- Files upload when you add them, so you need a connection and a saved task.
- Editing a comment keeps its files. Deleting a comment leaves its files on the task, and the question says so.
- A file deleted from the task reads "No longer available".

### Notify me

The **Notify me** button in the comments pane follows the task, so you are told about new comments. It reads "Notifying you" once on. It is only offered when you signed in with a password or single sign-on, not with an API token.

> [!WARNING]
> **If you sign in with an API token**, Vikunja can refuse some actions without a clear reason. When a token lacks permission for task comments, task assignees or project sharing, Vicu says which one is missing. Create a new token in Vikunja with those permissions, or sign in with your password. A change the token may not send goes to the list of changes that could not be sent, and the others carry on.

## Lists for shared work {all}

A [custom list](guide:custom-lists) can look at collaboration. In the list editor, the **Shared projects** section appears when something is shared or the list already uses one of these:

- **Assigned:** to me, to someone else, or to nobody
- **Comments:** unread or has comments. "Has comments" covers every project. "Unread" covers shared projects.
- **Only tasks in shared projects**
- **Changed:** today, or the last 3, 7 or 30 days

A task you read in an Unread list keeps its place until you leave the list, so it does not vanish while you read. Quick View on the desktop follows the same conditions.

## Routines you share {all}

A routine can be shared through a shared project. See [Routines](guide:routines).

## Details

- **Trusted text.** The assistant treats titles, notes and names from shared projects as data and never as instructions.
- **One account, one set of data.** Signing in as another person on the same install clears the first person's custom lists and settings, so two people never mix them.

## Related

- [Projects](guide:projects)
- [Custom lists](guide:custom-lists)
- [Routines](guide:routines)
- [Sync and offline](guide:sync)
