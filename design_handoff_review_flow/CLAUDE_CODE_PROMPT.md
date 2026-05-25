# Claude Code prompt — Vicu Review flow

Copy and paste the prompt below into Claude Code, running inside the Vicu repo. The handoff folder (`design_handoff_review_flow/`) should be at the repo root (or adjust the path in the prompt).

---

## The prompt

> I'm redesigning the **Review** screen in this app. The full design spec, sample data, and HTML reference prototype are in `design_handoff_review_flow/`. Start by reading `design_handoff_review_flow/README.md` end-to-end — it explains the three problems we're fixing, the chosen flow (Direction A: inline accordion with inline task expansion), exact layout/typography/color/spacing values, state shape, keyboard shortcuts, and the implementation checklist.
>
> Then:
>
> 1. Open `design_handoff_review_flow/reference/Vicu Review flow.html` in a browser to see the three explored flows in a pan/zoom canvas. Focus on the artboard labeled **"A · Inline accordion"**. The detail view that appears when you click a task (priority selector, due chips, labels, notes textarea, action row) is the critical interaction — the existing Review screen doesn't have this and that's the main reason the current flow is unpleasant.
>
> 2. Explore the existing codebase to understand:
>    - How the current Review screen is built (likely under `src/renderer/`).
>    - The sidebar implementation and how smart-list entries are added.
>    - The existing task component and how task editing is currently surfaced on the project page — we want to reuse those primitives inside the Review screen rather than build a parallel editor.
>    - The data layer for projects, sub-projects, tasks, and last-reviewed timestamps.
>    - The state-management pattern in use.
>    - The styling approach (CSS modules / Tailwind / inline / etc.) — the reference uses CSS custom properties from `vicu-tokens.css`, those values are already in the existing codebase under a similar token sheet (find it and use those tokens, don't duplicate hex values).
>
> 3. **Do not paste the reference JSX into the codebase.** The reference is light-on-purpose so you read it like a spec, not a copy source. Reimplement the design using the codebase's existing components, patterns, and styling system.
>
> 4. Implement Direction A. Use the checklist at the bottom of the README. Work in this order:
>    1. Sidebar changes — add Review entry, render project hierarchy.
>    2. Review screen header — title, count pill, progress bar.
>    3. Project tree list — sidebar order + hierarchy + last-reviewed pill + Mark reviewed button.
>    4. Project expand → inline task list.
>    5. **Task expand → inline detail editor** (the critical bit — reuse existing task-editor primitives).
>    6. Keyboard shortcuts (`J`/`K`/`Enter`/`R`/`S`/`Esc`).
>    7. Undo toast on mark-reviewed.
>    8. Empty state.
>    9. Dark-mode pass.
>
> 5. Before writing code: surface the three open questions at the end of the README and propose answers (we'll confirm).
>
> 6. Match dimensions, type, color, spacing, and radii **exactly** as specified — this is a hi-fi handoff. CSS custom properties only; no hard-coded hex.
>
> 7. Once the screen renders, walk me through the keyboard flow with a couple of test fixtures (use the data in `reference/lib/vicu-review-data.jsx` as a seed for whatever fixture format the codebase uses).
>
> Ask clarifying questions before writing code if anything in the spec is ambiguous or conflicts with patterns you find in the codebase.

---

## What to include in the chat with Claude Code (drag/paste these)

- `design_handoff_review_flow/` folder (the whole thing)
- Optional: 1-2 screenshots of the **current** Review screen, so it can see what we're replacing

## After Claude Code finishes

Verify against the README checklist. The big four to sanity-check by hand:

1. Click a task → the full detail editor (priority/due/labels/notes/subtask) opens inline. **Without** a route change.
2. Sidebar order = Review order. Sub-projects show as children of their parent in both places.
3. Pressing `R` on a focused project marks it reviewed, collapses it, fades it, advances focus.
4. Dark mode looks correct (Vicu's `.dark` class on root should be enough — the token sheet has both palettes).
