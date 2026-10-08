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
  chips, the checklist count ("1 of 3"), a notes icon and the repeat icon;
- the trailing cluster: the due phrase (a time or the overdue age), the reminder bell, and the
  priority mark last.

A row is at most two lines. It never repeats what the view already says: no "Today" in Today, no
day under a day header, no current tag in a Tag view, no project inside its own project.

The due date phrase comes from `cross-app-semantics-v1.md` section 8 and takes its colour from
the status: overdue `status.overdue`, due today `status.today`, anything else `text.secondary`.
A done row shows the check and a struck title. States: hover
`bg.hover`, selected `bg.selected`, keyboard focus `focus.ring`.

## 5. Headers

- Page title: `pageTitle` (desktop 26 px bold; Android 28 sp bold in a large top app bar that
  collapses on scroll). Today adds the full date (`header.full`) as a subtitle.
- Section header: `section` (13 px, 600) with a count in `text.secondary`.
- Group header: `group` (12 px, 600) with a dot.
- Day headers inside Upcoming use `header.day`.

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
move, `slowSpatial`, `fastEffects`, `defaultEffects`, `slowEffects`) for the custom `MotionScheme`.

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

## 9. Files and tests

| File | Role |
|---|---|
| `test-fixtures/design-tokens-v1.json` | the values (this document is its prose) |
| `docs/design-system-v1.md` | this document |
| `docs/cross-app-semantics-v1.md` | date phrasing and the completion hold |
| `test-fixtures/cross-app-semantics-v1.json` | their vectors (`dateDisplay`, `completion`) |

Each repo has a local test that compares these files (and the other shared fixtures and
documents) with the sibling checkout when it sits next to the repo, and is skipped otherwise.
