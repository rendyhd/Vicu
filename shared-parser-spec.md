# Shared Parser Module Specification

This document defines the exact parser behavior that BOTH Vicu (desktop) and Vicu Android must implement identically. Both apps must produce the same `ParseResult` for the same input string and the same `ParserConfig`.

The date and recurrence rules are the contract in `docs/cross-app-semantics-v1.md` section 5, and the test is the shared corpus `test-fixtures/nlp-corpus-v1.json` (70 cases, reference time Tue 2026-10-06 10:00 local; both apps run the same file). If this document and the corpus disagree, the corpus wins. The desktop implementation is `src/renderer/lib/task-parser/`: there is one parser (the main window, the task title editor and Quick Entry all call it), and the date work is done by chrono-node plus the rules below.

---

## ParserConfig Interface

```typescript
type SyntaxMode = 'todoist' | 'vikunja'
type TokenType = 'date' | 'priority' | 'label' | 'project' | 'recurrence'

interface ParserConfig {
  enabled: boolean        // Master toggle — when false, parse() returns raw input as title, nothing extracted
  syntaxMode: SyntaxMode  // Which prefix convention to use
  bangToday?: boolean     // The `!` -> today shortcut (setting "exclamation_today", default on)
  locale?: string         // Slash-date order; defaults to the device/system locale
  suppressTypes?: TokenType[]  // Token types the user dismissed: that extractor is skipped
}

const DEFAULT_PARSER_CONFIG: ParserConfig = {
  enabled: true,
  syntaxMode: 'todoist'   // Todoist is default — it's the industry standard most users already know
}
```

When `enabled` is `false`:
- `parse()` returns the input unchanged as the title with nothing extracted (callers trim it): `{ title: rawInput, dueDate: null, priority: null, labels: [], project: null, recurrence: null, tokens: [] }`
- No highlighting, no autocomplete, no preview chips
- The input field behaves as a plain text input (existing behavior before this feature)
- **Exception**: The `!` → today shortcut STILL works even when the parser is disabled (when `bangToday` is on) — it predates this feature and is an established convention in both apps. It is the same rule as when the parser is on (see "The `!` today shortcut" under Dates), so `parse()` applies it in both cases.

---

## Syntax Mode Comparison

| Feature | Todoist mode | Vikunja mode |
|---------|-------------|-------------|
| **Labels** | `@labelname` or `@"multi word"` | `*labelname` or `*"multi word"` |
| **Projects** | `#projectname` or `#"multi word"` | `+projectname` or `+"multi word"` |
| **Priority (short)** | `p1`–`p4` | `!1`–`!4` |
| **Priority (word)** | `!low` / `!med` / `!high` / `!urgent` | `!low` / `!med` / `!high` / `!urgent` |
| **Dates** | Natural language (identical) | Natural language (identical) |
| **Recurrence** | `every X`, `daily`, `weekly` (identical) | `every X`, `daily`, `weekly` (identical) |
| **`!` today shortcut** | `!` alone → today | `!` alone → today |
| **Autocomplete triggers** | `#` projects, `@` labels | `+` projects, `*` labels |

### Why two modes?

Vikunja's own web frontend uses `*label`, `+project`, `!4` priority, `@assignee`. Users coming from the Vikunja web app expect this syntax. Todoist's syntax (`@label`, `#project`, `p1`–`p4`) is the wider industry standard — most task app users know it. Offering both lets users pick what feels natural.

### Priority detail by mode

**Todoist mode** (Todoist's numbering: `p1` is the most urgent):
| Input | Priority Value | Display |
|-------|---------------|---------|
| `p4` or `!low` | 1 | Low |
| `p3` or `!medium` or `!med` | 2 | Medium |
| `p2` or `!high` | 3 | High |
| `p1` or `!urgent` or `!critical` | 4 | Urgent |

**Vikunja mode:**
| Input | Priority Value | Display |
|-------|---------------|---------|
| `!1` or `!low` | 1 | Low |
| `!2` or `!medium` or `!med` | 2 | Medium |
| `!3` or `!high` | 3 | High |
| `!4` or `!urgent` or `!critical` | 4 | Urgent |

The `!word` forms (`!low`, `!high`, etc.) work in BOTH modes. Only the short numeric form differs (`p1` vs `!1`).

**Critical: a lone `!` (no letter or digit immediately after it) means "today" in both modes** (full rule under Dates). The priority extractor must require a digit (`!1`–`!4`) or a known word (`!low`, `!med`, `!high`, `!urgent`) immediately after the `!`.

---

## ParseResult Interface

```typescript
interface ParseResult {
  title: string              // Cleaned task title (all tokens removed)
  dueDate: Date | null       // Extracted due date; its time of day only counts when dueHasTime is true
  dueHasTime: boolean        // The text named a time ("3pm", "14:30", "in 2 hours"): chrono start.isCertain('hour')
  priority: 1 | 2 | 3 | 4 | null  // Vikunja priority (1=low, 2=medium, 3=high, 4=urgent)
  labels: string[]           // Label names (prefix stripped)
  project: string | null     // Project name (prefix stripped)
  recurrence: {
    interval: number
    unit: 'day' | 'week' | 'month' | 'year'   // singular, as in the corpus
  } | null
  rawInput: string           // Original input for debugging
  tokens: ParsedToken[]      // All detected tokens with positions (for highlighting)
}

interface ParsedToken {
  type: TokenType
  value: string              // The matched text in the input (including prefix character)
  start: number              // Start index in rawInput
  end: number                // End index in rawInput
  display: string            // Human-readable (e.g., "Tomorrow 3:00 PM", "High", "shopping")
}
```

---

## parse() Function Signature

```typescript
export function parse(
  input: string,
  config: ParserConfig = DEFAULT_PARSER_CONFIG,
  reference: Date = new Date()   // "now": relative dates and the `!` shortcut; tests pass the corpus reference
): ParseResult
```

- When `config.enabled === false`: return with the input as the title and empty fields. Exception: still apply the `!` shortcut (when `config.bangToday`).
- When `config.enabled === true`: run extractors using prefix characters from `config.syntaxMode`.
- When a type is in `config.suppressTypes`: skip that extractor (its text stays in the title).

---

## Extractor Configuration by Mode

```typescript
interface SyntaxPrefixes {
  label: string     // '@' or '*'
  project: string   // '#' or '+'
}

function getPrefixes(mode: SyntaxMode): SyntaxPrefixes {
  switch (mode) {
    case 'todoist':  return { label: '@', project: '#' }
    case 'vikunja':  return { label: '*', project: '+' }
  }
}
```

Each extractor receives the appropriate prefix and builds its regex dynamically:

### Labels extractor
```typescript
// Todoist: /@"([^"]+)"|@(\S+)/g
// Vikunja: /\*"([^"]+)"|\*(\S+)/g
function buildLabelRegex(prefix: string): RegExp {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}"([^"]+)"|${escaped}(\\S+)`, 'g')
}
```

### Projects extractor
```typescript
// Todoist: /#"([^"]+)"|#([a-zA-Z][a-zA-Z0-9_-]*)/g
// Vikunja: /\+"([^"]+)"|\+([a-zA-Z][a-zA-Z0-9_-]*)/g
// CRITICAL: Only match prefix followed by a LETTER (not digit) — prevents #142 or +5 from matching
function buildProjectRegex(prefix: string): RegExp {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}"([^"]+)"|${escaped}([a-zA-Z][a-zA-Z0-9_-]*)`, 'g')
}
```

### Priority extractor
```typescript
function buildPriorityPatterns(mode: SyntaxMode): Array<{ regex: RegExp; value: 1|2|3|4 }> {
  // Word-based priorities — work in BOTH modes
  const wordPatterns = [
    { regex: /\b!low\b/i, value: 1 as const },
    { regex: /\b!med(ium)?\b/i, value: 2 as const },
    { regex: /\b!high\b/i, value: 3 as const },
    { regex: /\b!(urgent|critical)\b/i, value: 4 as const },
  ]
  
  if (mode === 'todoist') {
    // Todoist: p1-p4
    return [
      { regex: /\bp1\b/i, value: 1 },
      { regex: /\bp2\b/i, value: 2 },
      { regex: /\bp3\b/i, value: 3 },
      { regex: /\bp4\b/i, value: 4 },
      ...wordPatterns
    ]
  } else {
    // Vikunja: !1-!4 (must have digit immediately after !)
    return [
      { regex: /\b!1\b/, value: 1 },
      { regex: /\b!2\b/, value: 2 },
      { regex: /\b!3\b/, value: 3 },
      { regex: /\b!4\b/, value: 4 },
      ...wordPatterns
    ]
  }
}
```

---

## Parsing Order (Critical)

The parser MUST extract tokens in this exact order:

1. **Labels** (prefix-based: `@` or `*`) — extract and remove first
2. **Projects** (prefix-based: `#` or `+`) — extract and remove
3. **Priority** (mode-dependent short form + shared word form) — extract and remove
4. **Recurrence** (`every ...`, `daily`, `weekly`, etc.) — extract and remove
5. **Dates** (the date rules below on the remaining text) — extract and remove
6. **`!` today shortcut** — on the title that is left, when no date was found
7. **Title** — everything remaining, trimmed and collapsed whitespace

This order matters because:
- Prefix markers are unambiguous — grab them first
- In Vikunja mode, `!3` (priority) must be extracted BEFORE the date extractor sees `!`
- Recurrence must be extracted BEFORE dates because "every monday" contains "monday" (the weekday is then used as the due date, see Recurrence)
- Dates run after the other tokens so their text can't produce false dates

---

## Dates — identical in both modes

Contract: `docs/cross-app-semantics-v1.md` section 5.1; corpus: `test-fixtures/nlp-corpus-v1.json`. Dates are parsed with chrono-node (`forwardDate: true`) plus the rules below. Text already taken by labels, projects, priority and recurrence is invisible to the date parser.

- Natural language: `today`, `tomorrow`, weekday names, `this <weekday>`, `next <weekday>`, `next week`, `next month`, `in 3 days`, `in 2 weeks`
- Specific dates: `jan 15`, `15 jan`, `march 3rd`, `10/15`, `2026-10-15`
- With time: `tomorrow at 3pm`, `next friday 14:00`, `jan 15 9:30am`, `wed 3pm`
- Relative times: `in 2 hours`, `in 30 minutes` (the exact time)
- Special shortcut: the `!` today shortcut (below)

### Weekdays

- A bare weekday or `this <weekday>` is the next occurrence on or after today (today included). A date-only phrase is judged against the start of the day, so "tuesday" typed on a Tuesday afternoon is today, not next week.
- `next <weekday>` is that weekday in the following Monday-start week (Tue 2026-10-06: `next friday` = 2026-10-16; Sun 2026-10-04: `next monday` = 2026-10-05).
- `next week` is the Monday of the following week (chrono itself says "in 7 days"; do not use that). `next month` is the same day next month.
- **Three-letter abbreviations** (`mon`, `tue`, `tues`, `wed`, `thu`, `thur`, `thurs`, `fri`, `sat`, `sun`) only count as dates when the previous word is `on`, `next`, `this`, `by` or `due`, or when a time follows (`mon 9am`, `wed at 3pm`, `fri 14:00`). Otherwise they are plain words: "Buy sun cream", "Notes we sat on" and "Plan wed anniversary" have no date. Full weekday names always count.

### Connectors

The words `on`, `by` and `due` directly before a date phrase, and `at` directly before a time, are removed together with the date: "Submit report by friday" gives the title "Submit report", "Taxes due tomorrow" gives "Taxes", "Call at 9am" gives "Call". A connector with no date after it stays in the title.

### Times

- A time (`3pm`, `3:30pm`, `14:00`, optionally after `at`) can come before or after a date phrase.
- A time without a date is today if it is still ahead, otherwise tomorrow.
- `now` is never a date ("Do it now" keeps its title and has no due date).

### Slash dates

`10/15` follows the device locale's order: month/day for `en-US` (and any locale whose short date puts the month first), day/month for `en-GB` and most others. When the first number cannot be a month (`15/10` in `en-US`) the order flips. ISO dates (`2026-10-15`) are unambiguous. The locale is `ParserConfig.locale`, which defaults to the system locale (`navigator.language` on desktop). Dates without a year that already passed this year roll to next year (`jan 15` in October is next January); a date equal to today stays today.

### The `!` today shortcut

One rule in every entry point (new-task composer, task title editor, Quick Entry), implemented once as `extractBangToday` on desktop and applied by `parse()` whether the parser is enabled or not (only when `bangToday` is on):

- a standalone `!`, a leading `!` ("! call dentist", "!call dentist") or a trailing `!` ("call dentist !", "call dentist!") means today, date-only, and is removed from the title;
- a leading `!` followed by a priority token (`!1`-`!4`, `!low`, `!medium`, `!high`, `!urgent`) is that priority, not a date;
- a `!` inside the text ("Hello! world") is not a date and stays;
- when the parser found another date, the `!` is not used as a date.

### Stored due time (docs/cross-app-semantics-v1.md, section 1)

- A date without a time of day ("tomorrow", "jan 15", "in 3 days", "next week", the `!` shortcut) is stored as that
  local date at **23:59:59** (date-only), never midnight.
- A date with a time ("tomorrow at 3pm", "next friday 14:00", "in 2 hours") keeps the parsed time, to the minute. Desktop
  decides with `dueHasTime` (chrono's `start.isCertain('hour')`); the caller builds the stored value with
  `parsedDue(dueDate, dueHasTime)` (`src/shared/due-dates.ts`), which never mutates the parse result.

---

## Recurrence — identical in both modes

Contract: `docs/cross-app-semantics-v1.md` section 5.2.

| Input | interval | unit |
|-------|----------|------|
| `every day` or `daily` | 1 | day |
| `every week` or `weekly` | 1 | week |
| `every month` or `monthly` | 1 | month |
| `every year` or `yearly` or `annually` | 1 | year |
| `every 2 weeks` | 2 | week |
| `biweekly` or `fortnightly` | 2 | week |
| `every 3 days` | 3 | day |
| `every N {unit}` | N | unit |
| `every <weekday>` (full name) | 1 | week |

- **Shorthand** (`daily`, `weekly`, `monthly`, `yearly`, `annually`, `biweekly`, `fortnightly`) counts when it is the whole remaining input or its **last word**, after labels, projects and priority were removed: "Water plants daily" and "Water plants daily @home" are recurring; "weekly standup" and "Daily review tomorrow" are not (other words follow, so it describes them).
- **`every <weekday>`** (full name only) is weekly, and the due date is the next occurrence of that weekday (today included) unless the input has another date ("every friday starting oct 20" keeps oct 20). A time after the weekday applies ("every monday 10am" is Monday 10:00); a time on its own is not another date. Desktop leaves the weekday to the date extractor: the recurrence token covers `every` (or `every <weekday>` when another date is used).

### Recurrence → Vikunja API mapping
```typescript
function recurrenceToSeconds(r: { interval: number; unit: string }): number {
  const multipliers = { day: 86400, week: 604800, month: 2592000, year: 31536000 }
  return r.interval * multipliers[r.unit]
}
// repeat_mode = 0 (repeat after duration)
```

---

## Mapping ParseResult → Vikunja API

```typescript
// POST /api/v2/projects/{projectID}/tasks
interface VikunjaTaskPayload {
  title: string                    // ← parseResult.title
  due_date: string | null          // ← parsedDue(parseResult.dueDate, parseResult.dueHasTime) (date-only = local 23:59:59)
  priority: number                 // ← parseResult.priority ?? 0 (0 = unset)
  repeat_after: number             // ← recurrenceToSeconds(parseResult.recurrence)
  repeat_mode: 0 | 1 | 3          // ← 0 for standard repeat_after
  // Labels: read-only on create — use PUT /tasks/{taskID}/labels separately
  // Project: determined by projectID in the URL path
}
```

---

## Edge Cases

### Todoist mode
```typescript
"buy groceries"
→ { title: "buy groceries", dueDate: null, priority: null, labels: [], project: null }

"buy groceries tomorrow 3pm #shopping @errands p3"
→ { title: "buy groceries", dueDate: <tomorrow 15:00>, priority: 2, labels: ["errands"], project: "shopping" }

"review PR #142"
→ { title: "review PR #142", project: null }
// #142 NOT a project — # must be followed by a letter

"call dentist !"
→ { title: "call dentist", dueDate: <today> }

"weekly standup every monday 10am @work"
→ { title: "weekly standup", dueDate: <next monday 10:00>, labels: ["work"], recurrence: { interval: 1, unit: 'week' } }

"Submit report by fri"
→ { title: "Submit report", dueDate: <next friday, date-only> }
// "by" is a connector, so it goes with the date; "fri" counts because "by" precedes it

"Buy sun cream"
→ { title: "Buy sun cream", dueDate: null }
// "sun" is an abbreviation with no connector and no time

"Water plants daily"
→ { title: "Water plants", recurrence: { interval: 1, unit: 'day' } }

"p3 talk about p2p networking"
→ { title: "talk about p2p networking", priority: 2 }
// \bp2\b won't match "p2p"
```

### Vikunja mode
```typescript
"buy groceries tomorrow 3pm +shopping *errands !3"
→ { title: "buy groceries", dueDate: <tomorrow 15:00>, priority: 3, labels: ["errands"], project: "shopping" }

"review PR #142"
→ { title: "review PR #142", project: null }
// # is not a prefix in Vikunja mode

"email @john about the report"
→ { title: "email @john about the report", labels: [] }
// @ is not a label prefix in Vikunja mode

"task !4 *urgent +inbox"
→ { title: "task", priority: 4, labels: ["urgent"], project: "inbox" }

"call dentist !"
→ { title: "call dentist", dueDate: <today> }
// ! alone = today in both modes
```

### Parser disabled
```typescript
"buy groceries tomorrow 3pm #shopping @errands p3"
→ { title: "buy groceries tomorrow 3pm #shopping @errands p3", dueDate: null, priority: null, labels: [], project: null }
// No extraction at all

"call dentist !"
→ { title: "call dentist", dueDate: <today> }
// ! today shortcut STILL works when parser is disabled
```

---

## Syntax Hints (shown when input is empty)

**Todoist mode:**
```
# project   @ label   p1-p4 priority   ! today
```

**Vikunja mode:**
```
+ project   * label   !1-!4 priority   ! today
```

---

## Autocomplete Triggers by Mode

| Mode | Project dropdown triggers on | Label dropdown triggers on |
|------|------------------------------|---------------------------|
| Todoist | typing `#` | typing `@` |
| Vikunja | typing `+` | typing `*` |

---

## Settings Integration

### AppConfig additions (both apps)

```typescript
interface AppConfig {
  // ... existing fields ...
  
  nlp_enabled?: boolean                       // Default: true
  nlp_syntax_mode?: 'todoist' | 'vikunja'     // Default: 'todoist'
}
```

### Config → Parser bridge

```typescript
function getParserConfig(appConfig: AppConfig): ParserConfig {
  return {
    enabled: appConfig.nlp_enabled ?? true,
    syntaxMode: appConfig.nlp_syntax_mode ?? 'todoist'
  }
}
```

### Settings UI requirements

Both apps must have a settings section with:

1. **"Natural Language Parsing" toggle** — maps to `nlp_enabled`
   - Label: "Parse labels, projects, priority, and recurrence from task text"
   - Sublabel: "When off, Quick Entry is a plain text input (the ! today shortcut still works)"

2. **"Syntax Style" selector** — only visible when NLP is enabled — maps to `nlp_syntax_mode`
   - Option A: **Todoist** — `#project  @label  p1-p4` — "Industry standard (Todoist, TickTick)"
   - Option B: **Vikunja** — `+project  *label  !1-!4` — "Matches Vikunja's Quick Add Magic"
   - Show a live preview of the active syntax with example text

### Project/Label Validation

The parser does NOT validate whether projects/labels exist in Vikunja. That's the autocomplete layer.

Both apps implement fuzzy matching for autocomplete:
- Project prefix typed → dropdown of all projects from `GET /api/v2/projects`
- Label prefix typed → dropdown of all labels from `GET /api/v2/labels`
- Match by substring, case-insensitive
- Cache lists (refresh every 60s or on window focus)
