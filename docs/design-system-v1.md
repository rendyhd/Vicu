# Design system v1

This document says what the design tokens mean and how both Vicu apps use them, so the desktop
app (Electron, React) and the Android app (Compose Multiplatform, Material 3) look and move like
one product. The file is kept identical in both repos (`docs/design-system-v1.md`), next to
`cross-app-semantics-v1.md` (which owns what the text says: dates, completion) and
`description-format-v1.md`.

The values live in `test-fixtures/design-tokens-v1.json`, byte-identical in both repos like the
other fixtures. Prose explains the meaning; when the two disagree, the fixture wins. To change a
token, change the fixture and this document first, in both repos, in the same release.

How the apps consume it:

- Desktop: CSS variables and Tailwind role classes are generated from the fixture. The variable
  of a role is `--` plus the role with dots turned into dashes; the fixture lists the legacy
  aliases (`--bg-primary`, `--text-primary`, `--accent-blue`, `--border-color`, `--accent-red` to
  `--accent-teal`) that keep existing CSS working. A guard test fails on a hex colour, a pixel font
  size or a millisecond value in a component that should use a token.
- Android: `MaterialTheme` carries the generated Material 3 scheme (`android.colorScheme`),
  `LocalVicuColors` the colours outside the scheme (`android.custom`, priority, identity),
  `VicuMotion` the springs. Android has its own type and shape scales, so `type` and `radius`
  give the M3 style or dp value next to the desktop px value.

---

## 1. Colour roles

Every role has a light and a dark value. A role is chosen for what it means, never for how it looks.

| Group | Roles | Use |
|---|---|---|
| Surfaces | `bg.page`, `bg.sidebar`, `bg.card`, `bg.hover`, `bg.selected` | the page, the sidebar, cards and popovers, the hover fill, the selected fill. Text is only ever drawn on these five. |
| Lines | `border`, `control.ring` | `border` separates (rows, sections). It is never the only boundary of a control. `control.ring` draws checkbox and radio rings and holds 3:1 on page and card. |
| Text | `text`, `text.secondary`, `text.tertiary` | `text` for titles and values, `text.secondary` for meta, placeholders and counts (5.2:1 or more on every surface). `text.tertiary` is for disabled controls and decoration only; it is never readable text. |
| Accent | `accent`, `accent.fill`, `on.accent`, `focus.ring` | `accent` colours links and accent text. `accent.fill` is the fill of a primary button and the checked checkbox, with `on.accent` content on it (5.48:1). `focus.ring` is the keyboard focus outline (3:1 on page and card). |
| Status | `status.overdue`, `status.today`, `status.done` | the state of a date or a task. They are text-safe on every surface. |
| Danger | `danger` | destructive actions and clearing a date. Same value as overdue, a different meaning. |
| Priority | `priority.low`, `.medium`, `.high`, `.urgent` | the priority marks (section 3). Urgent covers priorities 4 and 5. |
| Palette | `palette.red` ... `palette.teal` | icon tints only. They do not pass text contrast and are never used for text. |

Rules:

- Identity colours (the smart lists in the fixture `identity`) only ever colour a list icon, never
  text, a fill behind text, a border or a chip. Today's yellow is for the sun icon, not for "Today".
- Colour never carries meaning alone. Overdue says "Yesterday" or "3 days ago" in words, a
  priority mark has a name for assistive technology, a done row has a check and a strike.
- Labels never read as status. A label chip (section 2) takes its own colour, tinted; it never uses
  `status.*`, `danger` or `priority.*`, so a red label is a label, not a warning. The reverse
  holds too: status and priority colours are never used for labels or projects.
- Hover, selected and focus are three different things: `bg.hover` fills under the pointer,
  `bg.selected` marks the selected row or item, `focus.ring` outlines the keyboard focus. A selected
  row that is also focused shows both.
- Dark theme raises surfaces by making them lighter (`bg.page` < `bg.sidebar` < `bg.card`), not with
  shadows. `bg.card` in dark adds a 1 px highlight, white at 8%, and no shadow.
- `bg.sidebar` has a translucent override on macOS (and Mica on Windows 11). It keeps its raw
  `var()` form on the desktop and never gets a channel variable or an opacity class. Its opaque
  value is the one contrast is asserted against.
- Overlays on a role (hover tints, 8% status tints, label chip fills) are the role colour at an
  alpha over the surface. On desktop, alpha goes through the role's channel variable (Tailwind
  `<alpha-value>`), never an opacity modifier on a raw `var()` colour.

Contrast is asserted by the fixture (`contrast.rules`) in both themes: text, `text.secondary`,
`accent`, `status.*`, `danger` and every priority role on all five surfaces at 4.5:1;
`on.accent` on `accent.fill` at 4.5:1; `control.ring` and `focus.ring` on page and card at 3:1;
`status.overdue` on its own 8% tint over `bg.page` at 4.5:1. Ratios are WCAG 2.x relative
luminance; a tint is composited and rounded to 8 bits before measuring. Both repos test the
fixture against these rules.

## 2. Label chips

A label chip is a pill (radius `full`, `chip` type: 11 px, weight 600, Android `labelSmall`).
Its fill is the label colour at 12% over `bg.page`; its text is the label colour moved in
lightness until the text passes 4.5:1 on that fill. The derivation is exact so both apps produce
the same hex (the fixture `labelChip.derivation` and `labelChip.vectors`):

1. `tint = round(0.12 * label + 0.88 * bg.page)` per channel, with the `bg.page` of the theme.
2. Convert the label to HSL. Hue and saturation stay fixed, only lightness moves.
3. Candidate `n` (n = 0, 1, 2 ...) has lightness `l - n/100` in light mode (darker) and
   `l + n/100` in dark mode (lighter), clamped to 0 to 1. Candidate 0 is the label itself.
4. Convert each candidate to sRGB with the standard HSL formulas, round each channel to 8 bits
   (`floor(c * 255 + 0.5 + 1e-9)`), once per candidate and never between steps.
5. The first candidate whose contrast against `tint` is at least 4.5 is the text colour.

The vectors cover the colours of Vikunja's own colour picker and the colours it gives new labels,
plus black, white and a mid grey, in both themes.

## 3. Priority marks

Priority is shown by a mark, never by colour alone, in the task row, Quick View and the
Android widgets. Priority 0 shows nothing.

| Priority | Mark | Colour role |
|---|---|---|
| 1 low | one bar | `priority.low` |
| 2 medium | two bars | `priority.medium` |
| 3 high | three bars | `priority.high` |
| 4 urgent, 5 do now | a filled square with "!" | `priority.urgent` |

The mark has an accessible name ("Low priority" ... "Urgent priority"). Android's "!" text count is
gone. The mark sits at the trailing edge of the row.

## 4. Row anatomy

A task row, left to right:

- the checkbox (ring `control.ring`, checked `accent.fill` with an `on.accent` check; target at
  least 24 px on desktop and 48 dp on Android);
- the body: the title (`taskTitle`) on line 1, level with the checkbox, and under it the meta line
  (`meta`, `text.secondary`) holding the project when the list or group does not imply it, label
  chips, the subtask count ("1 of 3"), a notes icon, the repeat icon, the attachment icon and,
  last, the comment count;
- the trailing cluster: the assignee avatars, the due phrase (a time or the overdue age), the
  reminder bell, and the priority mark last.

A row never repeats what the view already says: no "Today" in Today, no day under a day header, no
current tag in a Tag view, no project inside its own project.

**Density** is a setting per device, never synced, since a phone and a desktop window differ in
width (`rowDensity` in the fixture). **Compact**, the default: the title on one line, so a row is at
most two lines. **Comfortable**: the title wraps to at most three lines, and one line of notes
(`meta`, `text.secondary`, cut off with an ellipsis) sits between the title and the meta line in
place of the notes icon. The notes are their plain text with line breaks as spaces, without link
markers and images; notes with no text keep the icon. A row's height follows its content, and the
checkbox and the trailing cluster stay level with the title's first line.

Collaboration signals (`cross-app-semantics-v1.md` section 9) appear only when they carry
information: a task without assignees or comments looks the same in a shared project and in a
private one. The comment count is on every task; assignee avatars and the unread mark only on tasks
of shared projects.

- **Comment count**: shown when `comment_count` > 0. A comment icon (12 px desktop, 14 dp Android)
  and the number, in the meta style. It is its own target (24 px desktop, 48 dp Android) that opens
  the task's comments; its name is "4 comments" or "2 comments, new". When the task is unread (on a
  shared project), the count is `accent` (Android `primary`) at weight 600 (Android bold) and a dot
  of the same colour (6 px desktop, 7 dp Android) with a 1.5 ring of the row surface sits at the
  icon's top right; the weight change keeps the state visible without colour.
- **Avatars**: shown when the task has assignees, on shared projects. Circles of 18 px (20 dp), each after the first
  overlapping the one before by 5 and ringed 1.5 in the row surface; at most two, then "+N"
  (`caption`, `text.secondary`). People are ordered as in the contract (you first). The group's
  name is "Assigned to you, Maya". In forced colours an avatar gets an outline.
- **Avatar fallback**: until the server's image arrives, or when it fails, the first letter of the
  display name on `bg.selected` in `accent` (Android `secondaryContainer` and
  `onSecondaryContainer`). It is decoration and never carries meaning.

### 4.1 Open task properties

The open task (the desktop card bar, the Android editor) lists its properties in one order on both
apps: Date, Priority, Label, Subtasks, Reminder, Repeat, Project, **Assign**, Attachments,
**Comments**, More. A set property is a chip with a border, an unset one a quiet "+ Name".

- **Assign** exists only on shared projects. Unset: "+ Assign". Set: a stack of up to three avatars
  (16 px desktop, 20 dp Android) and the name list ("You, Maya"); named "Assigned: You, Maya". It
  opens a list of the project's members (desktop popover, Android bottom sheet) with a check per
  assignee; read-only members are disabled with "Can view only"; a pick toggles at once and the
  list stays open; the footer says "People {Project} is shared with. Assigned people get a
  notification." With read-only access the chip shows the assignees and does not open.
- **Comments** exists on every task, at the end before More. Without comments it is the icon
  alone; with comments the icon and the count in the set style; on a shared project it carries the
  unread dot until the comments are open. Desktop: it toggles the comments pane (Mod+Shift+C) and uses the open
  style while the pane shows. Android: it opens the Comments screen. Comments are never listed
  inside the card or the editor.

The due date phrase comes from `cross-app-semantics-v1.md` section 8 and takes its colour from
the status: overdue `status.overdue`, due today `status.today`, anything else `text.secondary`.
A done row shows the check and a struck title. States: hover
`bg.hover`, selected `bg.selected`, keyboard focus `focus.ring`.

### 4.2 Events and calendar events

Events and calendar events (`cross-app-semantics-v1.md` section 20) are on the Plan screen only. They
must never read as tasks: no checkbox, no priority mark, and a striped surface instead of a block's
flat tint.

- **Colour.** Each calendar has one colour: your own Events `#12a594`, a connected calendar the one
  chosen for it, by default the next of `#7c6cf2`, `#0a84ff`, `#30a46c`, `#e5484d`, `#f76b15`,
  `#12a594`. These are fixed values on both themes, not roles, and they only tint, edge and mark: no
  text is ever set in them.
- **A timed event** on the timeline: a `bg.page` surface with diagonal stripes of the calendar
  colour (135 degrees, 6 px each, at 16 % and 8 %), a `border` hairline, a 3 px left edge in the
  calendar colour and the `control` radius. Line 1 is a calendar icon (12 px desktop, 14 dp Android)
  in the calendar colour and the title (`meta`, weight 500, `text`); line 2 the time range, then
  " · " and the place (`caption`, `text.secondary`). An event shorter than 40 px keeps line 2 for
  screen readers only. Its name is the title, the range, the place, and "Tentative" or "Free" when
  they apply.
- **Tentative**: the hairline is dashed, and line 2 adds "Tentative".
- **Free**: the stripes at 8 % and 4 % and the left edge at 60 %; the words keep their colours, and
  line 2 adds "Free". Never fade the text: at 60 % it falls under 4.5:1.
- **All day**: a chip in the day's top row, before the tasks: the calendar colour at 14 % with a
  1 px border in the calendar colour, the `chip` radius, the calendar icon (12 px) and the title
  (`caption`, `text`). On the 3 days and Week views a chip is at most 16 rem wide on desktop.
- **Busy only** events read "Busy" or "Free" like any title.
- **Contrast.** `text` and `text.secondary` keep 4.5:1 on `bg.page` under the strongest tint (16 %
  of any calendar colour) in both themes; the stripes and the edge are decoration.
- **Forced colours**: the hairline and the left edge become `CanvasText`, the icon follows the text
  colour, and tentative and free keep their words, so nothing depends on the tint.
- **States**: keyboard focus `focus.ring` inside the event. A read-only event shows no grab cursor
  and no resize edges; your own Events have the block's.

## 5. Headers

- Page title: `pageTitle` (desktop 26 px bold; Android 28 sp bold in a large top app bar that
  collapses on scroll). Today adds the full date (`header.full`) as a subtitle.
- Section header: `section` (13 px, 600) with a count in `text.secondary`.
- Group header: `group` (12 px, 600) with a dot.
- Day headers inside Upcoming use `header.day`.
- Category header (project categories, cross-app semantics section 13): between the groups of
  top-level projects in the project list of the sidebar or drawer and in Settings. The category's
  name as the user typed it (never upper case) at the `group` size and weight 500, in
  `text.secondary`, under a `border` hairline that starts where the text starts. It stays quieter
  than the Projects section header above it: no upper case and no count while it is open.
  Collapsed (the sidebar and drawer only; which ones is kept per device) the number of its
  top-level projects follows the name after a middle dot ("Work · 3"); the chevron is the one the
  platform's other collapsible headers use. Its menu holds Rename, Move up, Move down and Delete
  category (desktop: right-click or ⋯; Android: a long press in the drawer, ⋮ in Settings). In a
  project picker the name alone heads its projects and cannot be picked.

Nothing is smaller than 11 px (11 sp on Android). Radii: `control` for inputs and buttons,
`popover` for menus and popovers, `card` for cards, `sheet` for Android bottom sheets, `chip` for
chips (full).

## 6. Motion

Tokens are in the fixture `motion`. A spring is a damping ratio and a stiffness (Compose
`spring(dampingRatio, stiffness)`); the desktop turns each spring into a CSS duration plus a
generated `linear()` curve, so the same spring feels the same on both.

| Token | Value | Use |
|---|---|---|
| fade.fast | 150 ms, standard easing | hover and focus changes, small fades |
| fade.base | 240 ms, enter and exit curves | menus, popovers, toasts, overlays |
| move | spring 0.9 / 700 (CSS 320 ms) | layout moves, opening and closing rows |
| move.expressive | spring 0.8 / 380 (CSS 440 ms) | reorders and drops |
| pop | spring 0.6 / 800 (CSS 360 ms) | the checkbox fill, the armed swipe |
| page | 90 ms out, 210 ms in, 6 px rise | changing views |
| stagger | 35 ms, at most 5 items | lists entering together |
| keyboard moves | at most 120 ms | moves caused by the keyboard |
| check draw, strike draw | 220 ms, 240 ms | completing a task |

`android.motionScheme` gives the six Compose slots (`fastSpatial` = pop, `defaultSpatial` =
move, `slowSpatial`, `fastEffects`, `defaultEffects`, `slowEffects`). Compose Multiplatform
material3 1.9.0 keeps `MotionScheme` internal, so Android carries them in `VicuMotion`, which
components read directly.

Material 3 Expressive is deferred (checked 2026-10-08). The newest stable Compose Multiplatform
material3 (1.9.0) and androidx material3 (1.4.0) keep `MotionScheme.expressive()` and the
Expressive opt-in internal, and have no public `FloatingActionButtonMenu`,
`HorizontalFloatingToolbar`, connected `ButtonGroup` or `LoadingIndicator`; they first appear in
androidx 1.5.0-beta01, experimental and without a stable multiplatform build. Revisit when a stable
multiplatform material3 exposes them: then add the FAB menu, a floating toolbar for selection, connected
buttons for the When sheet quick choices and the loading indicator for pull to refresh.

Motion moments:

- Complete: the ring fills (pop), the check draws, the title strike draws; the row stays for the
  completion hold, then fades and closes (move) while "Completed" with Undo appears
  (`cross-app-semantics-v1.md` section 7).
- Open a task: the row grows into the editor and back; a short fade where the platform cannot.
- Change view: the content region fades with a 6 px rise (`page`); the sidebar and title bar stay.
- Lists: new rows open from zero height, removed rows close, reorders animate with
  `move.expressive`, staggered; dragging lifts the row on pickup.
- Menus and popovers: enter from the anchor side, scale 0.96 to 1 with `fade.base`.
- Swipe (Android): the tint deepens with distance; at the commit point the colour goes full and the
  icon pops.
- Loading and counts: skeletons shimmer once; counts roll by one.
- Last task done: Today turns into "All clear" and offers the next task.

Reduced motion. Every animation has a reduced variant: fades only, no transform, no height
animation, no overshoot. Desktop honours `prefers-reduced-motion: reduce` in the CSS base layer
and `useReducedMotion()`. Android animations follow the system animator scale, and custom
`Animatable` loops must also end correctly at scale 0. Nothing waits for an animation to finish
before it accepts input.

## 7. Haptics (Android)

| Moment | Constant |
|---|---|
| Swipe passes its commit point | `GestureThresholdActivate` |
| Completing a task | `ToggleOn` |
| Bulk actions (complete, move, delete several) | `Confirm` |
| Reorder steps | `SegmentFrequentTick` |

Haptics follow the system touch feedback setting.

## 8. Android scheme and colours

- `android.colorScheme.light` and `.dark` hold every Material 3 role of the Compose `ColorScheme`
  (including the `surfaceContainer*` and fixed roles), generated once from the seed `#0A66D1` with
  material-color-utilities (fidelity variant, contrast level 0). They are data, not derived at
  run time. The Vicu scheme is the default; "Use device colours" in Settings switches to the
  wallpaper scheme, and then the status and swipe colours are harmonised to it.
- `android.custom` holds the colours the scheme has no slot for: `dueToday`, `done`,
  `swipeComplete` and `swipeSchedule`, each with a colour, its `on` colour, a container and an
  `on` container, every pair at 4.5:1.
- `android.statusMap` says which Android colour carries a status role: overdue is
  the scheme's `error`, due today is `custom.dueToday`, done is `custom.done`.
- `android.contrast` lists the pairs the Android tests assert against the generated data.
- Status and priority roles are text-safe on `surface`, `surfaceContainerLowest`,
  `surfaceContainerLow` and, for priority, `surfaceContainer`. On `surfaceContainerHigh` and
  above, set text in `onSurface` or `onSurfaceVariant` instead.

## 9. Pro

Pro (cross-app semantics section 21) uses the existing roles; it adds no token.

- **Promise rows.** A promise of theirs shows the person's mark (a circle with their initials, the
  avatar size of section 4) where the checkbox is, because it is not yours to tick; tapping it opens
  the verdict buttons. Below the title: the effective due phrase, then the person's quote in
  `text.secondary` italics when there is one, and an "In recap" mark (a chip in `accent` tint)
  once it was sent. Your own promise keeps its checkbox and shows "For Jan" on the meta line.
- **Verdict buttons** are text buttons in a row: Delivered, Late, Not yet, New date, Dropped, Ask
  me tomorrow; keys 1 to 6 on desktop. Not yet opens a date and a blocker inline. Colour never
  carries the meaning alone: each button has its word.
- **Unavailable rows** (Remaining and All views) keep the normal row with the title in
  `text.secondary` and one reason on the meta line ("Starts Mon 17 Nov", "After: Budget draft",
  "Waiting", "On hold"); the first task of a sequential project shows a "Next" chip.
- **Flags** are a filled flag icon in `accent-orange` after the title, with the accessible name
  "Flagged".
- **The Pro sidebar section** sits between the smart lists and the projects, with the same row
  anatomy as smart lists.

## 10. Files and tests

| File | Role |
|---|---|
| `test-fixtures/design-tokens-v1.json` | the values (this document is its prose) |
| `docs/design-system-v1.md` | this document |
| `docs/cross-app-semantics-v1.md` | date phrasing, the completion hold and collaboration |
| `test-fixtures/cross-app-semantics-v1.json` | their vectors (`dateDisplay`, `completion`, `collaboration`) |

Each repo has a local test that compares these files (and the other shared fixtures and
documents) with the sibling checkout when it sits next to the repo, and is skipped otherwise.
