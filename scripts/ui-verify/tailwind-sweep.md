# Tailwind class sweep (card 1.1b)

Written by card 1.1 for card 1.1b. Apply the 44 edits in section 3, add the guard test of section 5,
change nothing else. Card 1.1 does not apply any of them.

## 1. What was broken

Tailwind 3 can only put an opacity on a colour it can parse. Until card 1.1 the config had
`accent-blue: 'var(--accent-blue)'`, and the source used `bg-[var(--accent-blue)]/15`. Neither parses, so
Tailwind emitted no rule: the class silently did nothing (no selected-row fill, no hover tint, no
tinted due badge, no error-box tint). The scan found 104 such classes in 27 files:

| Kind | Count | Example | Fixed by |
|---|---|---|---|
| Named colour with an opacity | 60 | `hover:bg-accent-blue/90` | card 1.1: the colours are now `rgb(var(--accent-blue-rgb) / <alpha-value>)`; **no source edit** |
| Arbitrary var() with an opacity | 44 | `bg-[var(--accent-blue)]/15` | card 1.1b: rename to the named colour (section 3) |

Card 1.1 turned the 60 named classes on, so they already render in the app; the built CSS has
`.hover\:bg-accent-blue\/90:hover { background-color: rgb(var(--accent-blue-rgb) / 0.9) }`, and so on.

## 2. The rule

Replace `[var(--NAME)]` inside a colour utility by the Tailwind colour key of that variable, and keep
the variant prefix, the utility and the `/N` as they are:

```
bg-[var(--accent-blue)]/15                 ->  bg-accent-blue/15
hover:bg-[var(--accent-blue)]/20           ->  hover:bg-accent-blue/20
ring-[var(--accent-blue)]/40               ->  ring-accent-blue/40
border-[var(--border-color)]/50            ->  border-border/50
placeholder:text-[var(--text-secondary)]/50 ->  placeholder:text-text-secondary/50
```

Colour keys (the class is `<utility>-<key>`, e.g. `bg-accent-blue`, `text-text-secondary`):

| Variable | Key | Variable | Key |
|---|---|---|---|
| `--accent-blue` | `accent-blue` | `--text-primary` | `text` |
| `--accent-red` to `--accent-teal` | `accent-red` to `accent-teal` | `--text-secondary` | `text-secondary` |
| `--border-color` | `border` | `--text-tertiary` | `text-tertiary` |
| `--bg-primary` | `bg-page` | `--bg-hover` | `bg-hover` |
| `--bg-selected` | `bg-selected` | `--bg-sidebar` | none (raw `bg-sidebar`, no opacity) |

The occurrences below only use `accent-blue`, `border` and `text-secondary`; the full table is for
the guard test and later cards.

Opacity steps: Tailwind's scale (0, 5, 10, 15 ... 100) plus 8 and 12, the two tint alphas of the
token contract (overdue tint 8%, label chip 12%), added by card 1.1 to `theme.extend.opacity`. So
`TaskRow.tsx:496` keeps its `/8` (`bg-accent-blue/8`); nothing in the sweep changes a number.

Do not touch: `bg-[var(--accent-blue)]` and every other class without `/N` (they work), raw colours
such as `ring-red-500` or `bg-red-500/5` (stock Tailwind palette, not tokens), and
`bg-[rgba(...)]` classes (card 1.2 and 1.4b own those).

## 3. The 44 edits (arbitrary var() with an opacity)

Exact edits at the state of the tree when card 1.1 was written (file relative to `src/renderer/`,
line, the class string, its replacement). Replace the string inside the line; do not reformat the line, and keep the file's
line endings (six of these files are CRLF or mixed in the working tree; edit the string, never
rewrite the file). A line with two rows has two classes to replace.

| File | Line | Before | After |
|---|---|---|---|
| `components/layout/AppShell.tsx` | 674 | `hover:bg-[var(--accent-blue)]/20` | `hover:bg-accent-blue/20` |
| `components/rich-text/RichTextEditor.tsx` | 250 | `bg-[var(--accent-blue)]/15` | `bg-accent-blue/15` |
| `components/settings/ProjectSettings.tsx` | 135 | `border-[var(--border-color)]/60` | `border-border/60` |
| `components/sidebar/ProjectTreeItem.tsx` | 61 | `bg-[var(--accent-blue)]/15` | `bg-accent-blue/15` |
| `components/sidebar/TagList.tsx` | 182 | `bg-[var(--accent-blue)]/15` | `bg-accent-blue/15` |
| `components/task-list/ParentDropZone.tsx` | 28 | `bg-[var(--accent-blue)]/10` | `bg-accent-blue/10` |
| `components/task-list/RecurrencePickerPopover.tsx` | 114 | `bg-[var(--accent-blue)]/10` | `bg-accent-blue/10` |
| `components/task-list/RecurrencePickerPopover.tsx` | 127 | `bg-[var(--accent-blue)]/10` | `bg-accent-blue/10` |
| `components/task-list/SectionHeader.tsx` | 112 | `bg-[var(--accent-blue)]/10` | `bg-accent-blue/10` |
| `components/task-list/TaskCheckbox.tsx` | 31 | `hover:bg-[var(--accent-blue)]/10` | `hover:bg-accent-blue/10` |
| `components/task-list/TaskDragOverlay.tsx` | 15 | `border-[var(--accent-blue)]/30` | `border-accent-blue/30` |
| `components/task-list/TaskDragOverlay.tsx` | 16 | `border-[var(--accent-blue)]/50` | `border-accent-blue/50` |
| `components/task-list/TaskRow.tsx` | 495 | `bg-[var(--accent-blue)]/15` | `bg-accent-blue/15` |
| `components/task-list/TaskRow.tsx` | 495 | `ring-[var(--accent-blue)]/40` | `ring-accent-blue/40` |
| `components/task-list/TaskRow.tsx` | 496 | `bg-[var(--accent-blue)]/8` | `bg-accent-blue/8` |
| `components/task-list/TaskRow.tsx` | 496 | `ring-[var(--accent-blue)]/30` | `ring-accent-blue/30` |
| `components/task-list/TaskRow.tsx` | 498 | `bg-[var(--accent-blue)]/5` | `bg-accent-blue/5` |
| `components/task-list/TaskRow.tsx` | 674 | `bg-[var(--accent-blue)]/5` | `bg-accent-blue/5` |
| `components/task-list/TaskRow.tsx` | 772 | `bg-[var(--accent-blue)]/10` | `bg-accent-blue/10` |
| `components/task-list/TaskRow.tsx` | 797 | `bg-[var(--accent-blue)]/10` | `bg-accent-blue/10` |
| `components/task-list/TaskRow.tsx` | 819 | `bg-[var(--accent-blue)]/10` | `bg-accent-blue/10` |
| `components/task-list/TaskRow.tsx` | 839 | `bg-[var(--accent-blue)]/10` | `bg-accent-blue/10` |
| `components/task-list/TaskRow.tsx` | 853 | `bg-[var(--accent-blue)]/10` | `bg-accent-blue/10` |
| `components/task-list/TaskRow.tsx` | 875 | `bg-[var(--accent-blue)]/10` | `bg-accent-blue/10` |
| `components/task-list/TaskRow.tsx` | 896 | `bg-[var(--accent-blue)]/10` | `bg-accent-blue/10` |
| `components/task-list/TaskRow.tsx` | 918 | `bg-[var(--accent-blue)]/10` | `bg-accent-blue/10` |
| `components/UpdateBanner.tsx` | 46 | `bg-[var(--accent-blue)]/10` | `bg-accent-blue/10` |
| `components/UpdateBanner.tsx` | 56 | `hover:bg-[var(--accent-blue)]/20` | `hover:bg-accent-blue/20` |
| `views/ReauthView.tsx` | 122 | `placeholder:text-[var(--text-secondary)]/50` | `placeholder:text-text-secondary/50` |
| `views/ReauthView.tsx` | 171 | `placeholder:text-[var(--text-secondary)]/50` | `placeholder:text-text-secondary/50` |
| `views/ReauthView.tsx` | 189 | `placeholder:text-[var(--text-secondary)]/50` | `placeholder:text-text-secondary/50` |
| `views/ReauthView.tsx` | 232 | `placeholder:text-[var(--text-secondary)]/50` | `placeholder:text-text-secondary/50` |
| `views/SetupView.tsx` | 38 | `border-[var(--border-color)]/50` | `border-border/50` |
| `views/SetupView.tsx` | 43 | `border-[var(--border-color)]/50` | `border-border/50` |
| `views/SetupView.tsx` | 48 | `border-[var(--border-color)]/50` | `border-border/50` |
| `views/SetupView.tsx` | 53 | `border-[var(--border-color)]/50` | `border-border/50` |
| `views/SetupView.tsx` | 58 | `border-[var(--border-color)]/50` | `border-border/50` |
| `views/SetupView.tsx` | 63 | `border-[var(--border-color)]/50` | `border-border/50` |
| `views/SetupView.tsx` | 306 | `placeholder:text-[var(--text-secondary)]/50` | `placeholder:text-text-secondary/50` |
| `views/SetupView.tsx` | 429 | `placeholder:text-[var(--text-secondary)]/50` | `placeholder:text-text-secondary/50` |
| `views/SetupView.tsx` | 485 | `placeholder:text-[var(--text-secondary)]/50` | `placeholder:text-text-secondary/50` |
| `views/SetupView.tsx` | 503 | `placeholder:text-[var(--text-secondary)]/50` | `placeholder:text-text-secondary/50` |
| `views/SetupView.tsx` | 562 | `placeholder:text-[var(--text-secondary)]/50` | `placeholder:text-text-secondary/50` |
| `views/SetupView.tsx` | 626 | `placeholder:text-[var(--text-secondary)]/50` | `placeholder:text-text-secondary/50` |

Notes for the person applying them:

- `components/task-list/RecurrencePickerPopover.tsx` (lines 114 and 127) is one of the nine pickers
  card 1.3 migrates to the popover primitive. Apply those two by pattern after 1.3 has landed
  (the line numbers will have moved), or leave them if 1.3 already replaced the classes.
- `TaskRow.tsx:495` is the selected row (`bg-accent-blue/15`, `ring-accent-blue/40`), 496 the
  keyboard-focused row, 498 and 674 a drop target. After the sweep a selected row shows a fill.
- Check after applying: `grep -rnE "\[var\(--[a-z-]+\)\]/" src/renderer` prints nothing.

## 4. The named classes (no edit)

These 60 already work after card 1.1. Listed so the count of 104 can be checked; do not edit them.

| File | Lines and classes |
|---|---|
| `components/rich-text/LinkDialog.tsx` | 132 `hover:bg-accent-blue/90` |
| `components/settings/BrowserSettings.tsx` | 142 `hover:text-accent-blue/80`, 163 `hover:text-accent-blue/80` |
| `components/settings/ProjectSettings.tsx` | 143 `hover:bg-accent-blue/10`, 147 `hover:bg-accent-red/10`, 185 `hover:bg-accent-blue/90` |
| `components/settings/QuickEntrySettings.tsx` | 91 `border-accent-orange/40`, 91 `bg-accent-orange/10`, 232 `hover:text-accent-red/80`, 273 `bg-accent-blue/10` |
| `components/settings/SecretStorageNotice.tsx` | 23 `border-accent-orange/40`, 23 `bg-accent-orange/10` |
| `components/shared/ConfirmDialog.tsx` | 76 `hover:bg-accent-red/90`, 89 `hover:bg-accent-red/90`, 90 `hover:bg-accent-blue/90` |
| `components/shared/CustomListDialog.tsx` | 308 `bg-accent-blue/10`, 381 `hover:bg-accent-blue/90` |
| `components/shared/ToastHost.tsx` | 22 `border-accent-red/60` |
| `components/sidebar/ProjectTree.tsx` | 147 `hover:bg-accent-blue/90` |
| `components/sidebar/TagList.tsx` | 143 `hover:bg-accent-blue/90` |
| `components/sync/SyncPanel.tsx` | 163 `bg-accent-red/10` |
| `components/task-list/TaskContextMenu.tsx` | 279 `hover:bg-accent-red/10` |
| `components/task-list/TaskDueBadge.tsx` | 22 `bg-accent-red/10`, 23 `bg-accent-orange/10` |
| `components/task-list/TaskRow.tsx` | 945 `hover:bg-accent-red/10` |
| `views/ReauthView.tsx` | 100 `hover:bg-accent-blue/90`, 138 `hover:bg-accent-blue/90`, 210 `hover:bg-accent-blue/90`, 248 `hover:bg-accent-blue/90` |
| `views/RoutinesView.tsx` | 184 `bg-accent-blue/10`, 185 `bg-accent-blue/10`, 197 `bg-accent-blue/10`, 269 `bg-accent-green/15`, 327 `bg-accent-purple/15`, 341 `bg-accent-purple/15`, 363 `hover:bg-accent-red/10`, 367 `border-accent-orange/30`, 367 `bg-accent-orange/10`, 368 `border-accent-red/30`, 368 `bg-accent-red/10`, 369 `border-accent-red/30`, 369 `bg-accent-red/10` |
| `views/SettingsView.tsx` | 278 `border-accent-red/30`, 278 `hover:bg-accent-red/10`, 325 `hover:bg-accent-blue/90`, 344 `border-accent-red/30`, 344 `hover:bg-accent-red/10`, 461 `bg-accent-blue/10`, 493 `bg-accent-blue/10`, 576 `bg-accent-blue/5`, 598 `bg-accent-blue/5` |
| `views/SetupView.tsx` | 18 `hover:bg-accent-blue/20`, 319 `hover:bg-accent-blue/90`, 350 `hover:bg-accent-blue/90`, 378 `hover:bg-accent-blue/90`, 447 `hover:bg-accent-blue/90`, 524 `hover:bg-accent-blue/90`, 578 `hover:bg-accent-blue/90`, 644 `hover:bg-accent-blue/90`, 704 `hover:bg-accent-blue/90` |

## 5. The guard test

`src/renderer/lib/__tests__/tailwind-classes.test.ts` scans every `.ts`, `.tsx` and `.html` file under
`src/renderer` (skip `__tests__` folders and `*.test.ts`) and fails on:

1. **An opacity on an arbitrary var().** Any match of `/\[var\(--[\w-]+\)\]\/[\w.[\]]+/`. The message
   names file, line and the class, and suggests the named colour from the table in section 2.
2. **An opacity on a colour that has no channel variable.** Build the colour keys from
   `tailwindTheme(loadTokens()).colors` (import from `scripts/gen-tokens.mjs`; the typings are in
   `scripts/gen-tokens.d.mts`). A key whose value does not contain `<alpha-value>` (today only
   `sidebar`) must never be followed by `/N`: `bg-sidebar/50` fails.
3. **An opacity step that is not configured.** For every `<utility>-<key>/N` with `<key>` a colour key
   (longest keys first, so `text-secondary` wins over `text`), `N` must be a key of the resolved
   opacity scale (`resolveConfig(config).theme.opacity` from `tailwindcss/resolveConfig`, config
   loaded the way `tokens.test.ts` does: dynamic `import()` of `tailwind.config.ts` by file URL) or an
   arbitrary `[0.3]` value. `bg-accent-blue/8` passes (8 is configured); `bg-accent-blue/7` fails.

Candidate pattern for rules 2 and 3 (build the alternation from the key list, escape the dashes):

```
/(?<![\w-])(?:[a-z-]+:)*[a-z]+(?:-[a-z]+)*?-(KEY1|KEY2|...)\/(\d+(?:\.\d+)?|\[[^\]]+\])/g
```

Do not flag stock palette classes (`bg-red-500/5`, `ring-red-500`) or fractions (`w-1/2`): neither has a
token colour key before the slash. Add one positive test per rule that feeds the scanner a string
(`bg-[var(--accent-blue)]/15`, `bg-sidebar/50`, `bg-accent-blue/7`) and expects a finding, so the guard
cannot go quiet.

Build those test strings from parts (`['bg', 'accent-blue/7'].join('-')`): Tailwind's content scan
includes `__tests__` folders and would otherwise emit a rule for each example into the built CSS.

## 6. Accept

- The guard passes; the 44 edits are the only changes to component files (`git diff --stat` shows
  small per-file line counts, no whole-file rewrites).
- `npm run verify` is green.
- A capture of a selected row (click a task in Today, light and dark) shows a blue fill and ring;
  before the sweep it shows neither.
