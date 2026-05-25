# Handoff: Vicu Review Flow Redesign

## Overview

This handoff covers a redesign of Vicu's **Review** screen — the GTD-style weekly-review surface that surfaces projects that haven't been reviewed in 2+ weeks.

The current implementation has three problems we are fixing:

1. **Reviewing forces you to leave Review.** Clicking a project navigates to the project page; you have to click the Review tab again to advance. The round-trip kills the rhythm.
2. **Sub-projects and top-level projects look identical.** No parent/child hierarchy is shown — you lose the "what belongs to what" map.
3. **The order doesn't match the sidebar.** Two different mental indexes for the same set of projects.

The redesign:

- Renders the review list **in sidebar order, with parent → child hierarchy** (indent + tree-line connector).
- Lets you do **full task editing inline** — priority, due date, labels, notes, subtasks, move/convert/delete — **without ever leaving the Review screen**.
- Adds a **progress affordance** ("3 of 12 reviewed") so the ritual has a finish line.
- Adds a **"Mark reviewed" pill** per project; reviewed projects collapse and fade.

## About the design files

The files in `reference/` are an **HTML+React+Babel design prototype**, not production code. They exist to show pixel-level intent, interaction patterns, copy, and the visual hierarchy. Recreate the design in Vicu's existing renderer (looks like `src/renderer/` from the repo layout) using its established patterns — components, state management, styling system. Don't ship the HTML.

## Fidelity

**Hi-fi.** Pixel-perfect colors, type, spacing. Recreate exactly using Vicu's existing component library and design tokens.

## Three directions explored

We built three flows on a spectrum from "familiar list" → "deliberate ritual":

| Direction | File | What it is |
|---|---|---|
| **A · Inline accordion** *(chosen)* | `directions/review-a.jsx` | List preserves sidebar order + hierarchy. Click a project → tasks expand in place. Click a task → expands further with full editor controls. |
| B · Master-detail split | `directions/review-b.jsx` | List on left (320px), full editable project surface on right. R-key = mark reviewed + advance. |
| C · Focus stepper | `directions/review-c.jsx` | One project at a time on a centered card, prev/next arrows, step dots. Most ritual-flavoured. |

**Implement Direction A first.** B and C are kept as future power-user modes — likely behind a setting once A ships.

---

## Direction A — Inline Accordion (implement this)

### Layout

Window chrome: `var(--bg-primary)`, 12px border-radius, 32px title bar with macOS traffic lights centered title "Review — Vicu".

Two columns:
- **Sidebar** (220px, `var(--bg-sidebar)`): unchanged in structure, but with two changes (see "Sidebar changes" below).
- **Main content**: header → progress bar → tree list of projects.

### Sidebar changes (apply to the existing sidebar)

1. Add a **Review** entry between **Anytime** and **Logbook**:
   - Icon: refresh/repeat (lucide `RefreshCw` or similar), `var(--accent-purple)` (`#AF52DE`).
   - Right-aligned count = number of projects due for review.
   - When the count > 0 and Review is the active tab, surround with a 1px `rgba(175,82,222,0.4)` border and color the count purple, weight 600. This is the only smart-list entry with a tinted active border — it signals "you have work here".

2. **Show project hierarchy in the sidebar** (also fixes the order-mismatch complaint):
   - Top-level projects: 8×8 square color dot (border-radius 2), font-weight 500 when active, 400 otherwise.
   - Sub-projects: indented 16px per depth, 8×8 circular color dot at 0.55 opacity, 1px `var(--border-color)` vertical tree-line on the left.
   - Both render in the order the user has them in their project tree.

### Main content header

```
padding: 20px 28px 14px
border-bottom: 1px solid var(--border-color)
```

Row 1: refresh icon (20×20, `--accent-purple`) + "Review" (22px, font-weight 700, letter-spacing -0.01em) + count pill ("N due", 11px/600, padding 2px 8px, border-radius 999, background `rgba(175,82,222,0.15)`, color `--accent-purple`).

Row 2 (12px secondary): "Click a project to review tasks in place. Press `R` to mark reviewed." The "R" is rendered as a small `<kbd>`-style chip — SF Mono 10px, padding 1px 5px, border-radius 3, background `var(--bg-hover)`, 1px `var(--border-color)`.

Row 3: Progress bar (4px tall, border-radius 2, track `var(--bg-hover)`, fill `--accent-purple`) + tabular-nums label "3 / 12" (11px secondary).

### The tree list

Scrollable container, padding 8px 16px 24px.

Each project row:

```
display: flex; align-items: center; gap: 10px
padding: 8px 10px; border-radius: 8px
margin-left: depth * 18px   // 0 for top-level, 18 for sub
background: open ? var(--bg-hover) : transparent
cursor: pointer
opacity: reviewed ? 0.45 : 1
```

Contents in order:
1. Chevron (12×12 `--text-secondary`, rotate 90° when open).
2. Color dot: top-level = 10×10 rounded-2, depth>0 = 10×10 rounded-5 at 0.6 opacity.
3. Title: top-level = 14px/600, sub = 13px/500.
4. Sub-project count, only on parents with children: "N sub-projects" (10px/`--text-tertiary`, tabular-nums).
5. **Last-reviewed pill**:
   - `daysSinceReview == null` → "Never reviewed", red bg `rgba(255,59,48,0.12)`, red text.
   - `>= 21 days` → "21d ago", red bg/red text.
   - `>= 14 days` → "16d ago", orange bg `rgba(255,149,0,0.12)`, orange text.
   - else → "12d ago", `var(--bg-hover)` bg, `--text-secondary` text.
   - All: 10px/600, padding 2px 7px, border-radius 999.
6. Spacer (flex-grow).
7. "N tasks" text (11px secondary).
8. **"✓ Mark reviewed" button** (purple ghost: 11px/600, padding 4px 10px, border-radius 6px, transparent bg, `--accent-purple` text, 1px `rgba(175,82,222,0.4)` border). On click → mark reviewed (project collapses + fades to 0.45 opacity), button replaced with "✓ Reviewed" in `--accent-green`.

**Tree-line connector for sub-projects:** a 1px `var(--border-color)` vertical line at left:-12px from the row, plus a 10px horizontal stub at top:22px. Lines render through the parent's children block so multiple subs share the trunk.

### Sub-project rendering

When a parent has `children`, render children **after** the parent's tasks block, with `marginLeft = depth * 18 + 26` so they sit under the chevron + color dot.

### Expanding a project

When a project is expanded, its tasks render below the project header at `paddingLeft: 26 + depth * 18`. Each task is its own clickable row that expands inline (see below). At the bottom of each task list: a ghost "+ Add task" button (transparent, no border, 12px secondary).

### Task row (collapsed)

```
display: flex; align-items: center; gap: 10px
padding: 8px 10px; border-radius: 8px; font-size: 12.5px
background: transparent (or var(--bg-secondary) when expanded)
border: 1px solid transparent (or var(--border-color) when expanded)
cursor: pointer
```

Contents:
1. Drag handle: "⋮⋮" character (or your drag icon), `--text-tertiary`.
2. Checkbox (existing component).
3. Title (flex-grow, truncate).
4. Priority dot (existing component, 8×8 colored circle).
5. Due-date chip if set: "Overdue" red bg/text, else date in `--text-secondary`.
6. Chevron-right (11×11 `--text-tertiary`, rotate 90° when expanded).

Clicking the row toggles the expanded detail surface.

### **Task expanded detail surface** ← The critical interaction

When a task is expanded, the row gets `background: var(--bg-secondary)`, `border: 1px solid var(--border-color)`, `border-radius: 8px`. Below the row header, render a detail panel:

```
padding: 4px 14px 14px 38px   // left-aligned with task title
border-top: 1px dashed var(--border-color)
display: flex; flex-direction: column; gap: 10px
```

The panel contains, in order:

**1. Priority selector** — labelled "PRIORITY" (9px/700/uppercase/0.08em letter-spacing, `--text-tertiary`).
Row of 5 segmented buttons: Urgent (red), High (orange), Med (yellow), Low (blue), None (tertiary).
Each: padding 3px 8px, border-radius 5px, 11px/500, gap 4px between dot and label.
Active state: `--bg-hover` bg + 1px `--border-color` border, label color `--text-primary`.
Inactive: transparent bg + transparent border, label `--text-secondary`.

**2. Due date** — labelled "DUE DATE".
Row of chip buttons: "Today", "Tomorrow", "This week", "Pick…". Each is the standard chip (`padding: 3px 9px, border-radius: 5px, 11px/500, 1px var(--border-color) border, transparent bg, --text-secondary text`).

**3. Labels** — labelled "LABELS".
Existing labels render as 10px/500 pills with tinted background (label color at 14% opacity) and label-color text. Trailing "+ Add" chip with dashed border + `--text-tertiary` text.

**4. Notes** — labelled "NOTES".
`<textarea>`: width 100%, min-height 44px, padding 7px 9px, border-radius 6, 1px `--border-color` border, `--bg-primary` bg, 12px text, no resize, placeholder "Add a note…".

**5. Action row** (flex, gap 8px):
- "+ Subtask" chip — `--accent-blue` text, `rgba(0,122,255,0.3)` border.
- "Move to project…" chip — standard.
- "Convert to project" chip — standard.
- Flex spacer.
- "Delete" chip — `--accent-red` text, no border.

### Interaction notes

- Only one task can be expanded at a time. Clicking another collapses the current.
- Multiple projects can be expanded simultaneously.
- Marking a project reviewed:
  - Collapses it.
  - Reduces opacity to 0.45.
  - Replaces the "Mark reviewed" button with "✓ Reviewed" green text.
  - Increments the progress bar; if all are done, show a celebratory empty state ("All reviewed — nice work").
- Marking a project reviewed should be undoable (toast: "Marked Personal reviewed — Undo").

### Keyboard shortcuts

- `J` / `K` — move selection up/down the tree (project rows).
- `Space` / `Enter` — toggle expand on focused row.
- `R` — mark focused project reviewed (collapses + advances focus to next due).
- `S` — skip / snooze 1 week.
- `Esc` — collapse all.

### Empty state

When all due projects are reviewed:
- Refresh icon centered, `--accent-green`, 48px.
- Heading "All reviewed" (20px/600).
- Sub-text "You're caught up. Next review available in 14 days." (13px `--text-secondary`).

---

## Design tokens

All tokens come from `reference/lib/vicu-tokens.css` — light and dark variants are already defined. Use **CSS custom properties**, not hard-coded hex.

### Colors used in this redesign

| Token | Light | Dark |
|---|---|---|
| `--bg-primary` | `#FFFFFF` | `#1C1C1E` |
| `--bg-secondary` | `#F5F5F7` | `#2C2C2E` |
| `--bg-sidebar` | `#F5F5F7` | `#2C2C2E` |
| `--bg-hover` | `#F2F2F7` | `#3A3A3C` |
| `--bg-selected` | `#E8F0FE` | `#1C3049` |
| `--text-primary` | `#1D1D1F` | `#F5F5F7` |
| `--text-secondary` | `#86868B` | `#98989D` |
| `--text-tertiary` | `#AEAEB2` | `#636366` |
| `--border-color` | `#E5E5EA` | `#38383A` |
| `--accent-purple` (review brand) | `#AF52DE` | `#BF5AF2` |
| `--accent-red` (urgent/overdue) | `#FF3B30` | `#FF453A` |
| `--accent-orange` (warn) | `#FF9500` | `#FF9F0A` |
| `--accent-green` (reviewed) | `#34C759` | `#30D158` |
| `--accent-blue` (primary action) | `#007AFF` | `#0A84FF` |

### Typography

System stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif`. Monospace: `"SF Mono", ui-monospace, Menlo, Consolas, monospace`.

| Use | Size | Weight | Notes |
|---|---|---|---|
| Page H1 ("Review") | 22px | 700 | letter-spacing -0.01em |
| Project title (top-level) | 14px | 600 | |
| Project title (sub) | 13px | 500 | |
| Task title | 12.5px | 400 | |
| Section header | 11px | 700 | uppercase, letter-spacing 0.08em, `--text-tertiary` |
| Field label (e.g. "PRIORITY") | 9px | 700 | uppercase, letter-spacing 0.08em |
| Pill / chip | 10–11px | 500–600 | |

### Spacing scale

4px grid. Common values: 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28.

### Radii

| Use | Radius |
|---|---|
| Window | 12px |
| Cards / detail surface | 8px |
| Chips / buttons | 5–6px |
| Pills | 999px |
| Color dot (square) | 2px |
| Color dot (sub-project / circle) | 50% |
| Progress bar | 2px |

### Shadows

- Window: `0 30px 80px rgba(0,0,0,0.22), 0 6px 14px rgba(0,0,0,0.08)`
- Card: `0 16px 40px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.06)`
- Standard sm: `0 1px 2px rgba(0,0,0,0.04)`

---

## State & data

### State

- `expandedProjectIds: Set<string>` — which projects are currently open.
- `expandedTaskId: string | null` — at most one task expanded at a time.
- `reviewedProjectIds: Set<string>` — marked reviewed this session.
- `focusedProjectId: string | null` — for keyboard navigation.

### Data shape (each project node)

```ts
type ReviewNode = {
  id: string;
  title: string;
  color: string;         // hex
  daysSinceReview: number | null;   // null = never reviewed
  children?: ReviewNode[];          // sub-projects
  tasks: Task[];
};

type Task = {
  id: number;
  title: string;
  priority?: 0 | 1 | 2 | 3 | 4;     // 4 = urgent
  due?: 'today' | 'overdue' | string; // ISO or short string
  labels?: string[];
  notes?: string;
};
```

The full sample tree is in `reference/lib/vicu-review-data.jsx` — use it as a fixture for the implementation and storybook.

### What "due for review" means

A project is due for review if `daysSinceReview >= REVIEW_INTERVAL_DAYS` (default 14, user-configurable) OR `daysSinceReview == null`.

Marking a project reviewed sets `lastReviewedAt = now()`.

### "All tracked" vs "Due" tabs

Today's screen has two tabs. Keep them:
- **Due** (default): only projects past the threshold.
- **All tracked**: every project with review tracking enabled, sorted by `daysSinceReview` desc (most stale first), in sidebar order.

---

## Reference files

In `reference/`:

- `Vicu Review flow.html` — open this in a browser to see all three directions side-by-side in a pan/zoom canvas.
- `lib/vicu-tokens.css` — the full token sheet (light + dark).
- `lib/vicu-review-data.jsx` — the sample review tree used in the prototype.
- `lib/vicu-ui.jsx` — the shared UI primitives (chrome, sidebar with hierarchy support, icons, avatars, task checkbox, priority dot, label chip, due badge).
- `directions/review-a.jsx` — **the chosen direction** (inline accordion + inline task editor).
- `directions/review-b.jsx`, `review-c.jsx` — alternate directions, kept for future power-user modes.
- `directions/review-notes.jsx` — diagnosis + principles (good context for any teammate joining).

---

## Implementation checklist

- [ ] Sidebar: add **Review** smart-list entry between Anytime and Logbook.
- [ ] Sidebar: render projects with parent → child hierarchy (indent + tree line).
- [ ] Review screen: header (icon + title + count pill + helper text + progress bar).
- [ ] Tree list rendering matches sidebar order + hierarchy.
- [ ] Last-reviewed pill with three threshold states.
- [ ] Per-project "Mark reviewed" button → collapse + fade.
- [ ] Project expand/collapse on row click.
- [ ] Task row inside an expanded project (collapsed state).
- [ ] **Task row expands inline into the full detail editor** (priority / due / labels / notes / subtask / move / delete).
- [ ] Only one task expanded at a time.
- [ ] Keyboard: `J`/`K`/`Enter`/`R`/`S`/`Esc`.
- [ ] Undo toast on mark-reviewed.
- [ ] Empty state when all done.
- [ ] Dark-mode parity (CSS vars do most of the work).

## Open questions for product

- Does "Mark reviewed" need a confirmation step the first few times, or trust the undo toast?
- Should sub-projects be reviewable independently of their parent, or do you only review the top-level (and sub-projects come "for free")? The prototype assumes independent.
- "Snooze 1 week" — does that bump `daysSinceReview` backward, or set a `nextReviewAt` override? Decide before implementing the keyboard `S` shortcut.
