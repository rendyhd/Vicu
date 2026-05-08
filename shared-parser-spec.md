# Shared Parser Module Specification

This document defines the exact parser behavior that BOTH Vicu and vikunja-quick-entry must implement identically. Both apps must produce the same `ParseResult` for the same input string and the same `ParserConfig`.

---

## ParserConfig Interface

```typescript
type SyntaxMode = 'todoist' | 'vikunja'
type TokenType = 'date' | 'priority' | 'label' | 'project' | 'recurrence'

interface ParserConfig {
  enabled: boolean        // Master toggle — when false, parse() returns raw input as title, nothing extracted
  syntaxMode: SyntaxMode  // Which prefix convention to use
}

const DEFAULT_PARSER_CONFIG: ParserConfig = {
  enabled: true,
  syntaxMode: 'todoist'   // Todoist is default — it's the industry standard most users already know
}
```

When `enabled` is `false`:
- `parse()` returns `{ title: rawInput.trim(), dueDate: null, priority: null, labels: [], project: null, recurrence: null, rawInput, tokens: [] }`
- No highlighting, no autocomplete, no preview chips
- The input field behaves as a plain text input (existing behavior before this feature)
- **Exception**: The `!` → today shortcut STILL works even when the parser is disabled — it predates this feature and is an established convention in both apps

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

**Todoist mode:**
| Input | Priority Value | Display |
|-------|---------------|---------|
| `p1` or `!low` | 1 | Low |
| `p2` or `!medium` or `!med` | 2 | Medium |
| `p3` or `!high` | 3 | High |
| `p4` or `!urgent` or `!critical` | 4 | Urgent |

**Vikunja mode:**
| Input | Priority Value | Display |
|-------|---------------|---------|
| `!1` or `!low` | 1 | Low |
| `!2` or `!medium` or `!med` | 2 | Medium |
| `!3` or `!high` | 3 | High |
| `!4` or `!urgent` or `!critical` | 4 | Urgent |

The `!word` forms (`!low`, `!high`, etc.) work in BOTH modes. Only the short numeric form differs (`p1` vs `!1`).

**Critical: `!` alone (no letter or digit immediately after it) always means "today" in both modes.** The priority extractor must require a digit (`!1`–`!4`) or a known word (`!low`, `!high`) immediately after the `!`. A lone `!` at end of input or followed by whitespace is always the date shortcut.

---

## ParseResult Interface

```typescript
interface ParseResult {
  title: string              // Cleaned task title (all tokens removed)
  dueDate: Date | null       // Extracted due date/time
  priority: 1 | 2 | 3 | 4 | null  // Vikunja priority (1=low, 2=medium, 3=high, 4=urgent)
  labels: string[]           // Label names (prefix stripped)
  project: string | null     // Project name (prefix stripped)
  recurrence: {
    interval: number
    unit: 'days' | 'weeks' | 'months' | 'years'
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
  suppressTypes: Set<TokenType> = new Set()
): ParseResult
```

- When `config.enabled === false`: return immediately with raw title and empty fields. Exception: still handle lone `!` → today.
- When `config.enabled === true`: run extractors using prefix characters from `config.syntaxMode`.
- When a type is in `suppressTypes`: skip that extractor (its text stays in the title).

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
5. **Dates** (sugar-date on remaining text, plus `!` → today) — extract and remove
6. **Title** — everything remaining, trimmed and collapsed whitespace

This order matters because:
- Prefix markers are unambiguous — grab them first
- In Vikunja mode, `!3` (priority) must be extracted BEFORE the date extractor sees `!`
- Recurrence must be extracted BEFORE dates because "every monday" contains "monday"
- Dates run last to avoid false positives from removed token text

---

## Dates (via sugar-date) — identical in both modes

- Natural language: `today`, `tomorrow`, `next monday`, `in 3 days`, `next week`, `end of month`
- Specific dates: `jan 15`, `march 3rd`, `12/25`, `2026-03-01`
- With time: `tomorrow at 3pm`, `next friday 14:00`, `jan 15 9:30am`
- Relative: `in 2 hours`, `in 30 minutes`
- Special shortcut: `!` alone means "today" — both modes, even when parser is disabled

---

## Recurrence — identical in both modes

| Input | interval | unit |
|-------|----------|------|
| `every day` or `daily` | 1 | days |
| `every week` or `weekly` | 1 | weeks |
| `every month` or `monthly` | 1 | months |
| `every year` or `yearly` or `annually` | 1 | years |
| `every 2 weeks` or `biweekly` | 2 | weeks |
| `every 3 days` | 3 | days |
| `every N {unit}` | N | unit |

`weekly`/`monthly`/`yearly` as standalone only — `weekly standup` should NOT extract recurrence because "weekly" is an adjective modifying "standup".

### Recurrence → Vikunja API mapping
```typescript
function recurrenceToSeconds(r: { interval: number; unit: string }): number {
  const multipliers = { days: 86400, weeks: 604800, months: 2592000, years: 31536000 }
  return r.interval * multipliers[r.unit]
}
// repeat_mode = 0 (repeat after duration)
```

---

## Mapping ParseResult → Vikunja API

```typescript
// PUT /api/v1/projects/{projectID}/tasks
interface VikunjaTaskPayload {
  title: string                    // ← parseResult.title
  due_date: string | null          // ← parseResult.dueDate?.toISOString()
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
→ { title: "buy groceries", dueDate: <tomorrow 15:00>, priority: 3, labels: ["errands"], project: "shopping" }

"review PR #142"
→ { title: "review PR #142", project: null }
// #142 NOT a project — # must be followed by a letter

"call dentist !"
→ { title: "call dentist", dueDate: <today> }

"weekly standup every monday 10am @work"
→ { title: "weekly standup", dueDate: <next monday 10:00>, labels: ["work"], recurrence: { interval: 1, unit: 'weeks' } }

"p3 talk about p2p networking"
→ { title: "talk about p2p networking", priority: 3 }
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
- Project prefix typed → dropdown of all projects from `GET /api/v1/projects`
- Label prefix typed → dropdown of all labels from `GET /api/v1/labels`
- Match by substring, case-insensitive
- Cache lists (refresh every 60s or on window focus)
