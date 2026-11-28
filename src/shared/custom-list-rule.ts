/**
 * A custom list's rule: a condition in the filter language of Vikunja's saved filters
 * (docs/cross-app-semantics-v1.md, section 3.5). Android has the same in `CustomListRule.kt`; both
 * run the `customListRule` vectors.
 *
 * `parseRule` reads the text into a tree without judging the fields, so an import can remove the
 * terms Vicu does not support (`withoutTerms`) before `checkRule` decides whether it is valid.
 * `compileRule` turns a valid rule into a predicate for one moment, in the process time zone.
 *
 * It imports only `week-start.ts`, a sibling without imports, so any tsconfig can include it.
 */

import { daysIntoWeek, getWeekStart, type WeekStart } from './week-start'

export const MAX_RULE_BYTES = 16 * 1024
export const MAX_RULE_DEPTH = 100
export const MAX_BUSINESS_DAYS = 10_000

export type RuleJoin = 'and' | 'or'
export type RuleOp = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'like' | 'in' | 'not in'

export interface RuleTerm {
  kind: 'term'
  field: string
  op: RuleOp
  /** The value as written: unquoted, escapes resolved. */
  value: string
  quoted: boolean
  start: number
  /** The value's place in the source, quotes included, for editors that rewrite it. */
  valueStart: number
  valueEnd: number
}

export interface RuleGroup { kind: 'group'; items: RuleItem[] }

/** One element of a sequence and the join in front of it (ignored for the first). */
export interface RuleItem { join: RuleJoin; node: RuleTerm | RuleGroup }

export type RuleErrorCode = 'syntax' | 'unknown_field' | 'unsupported_field' | 'bad_operator' | 'bad_value' | 'too_complex'

export interface RuleError { code: RuleErrorCode; message: string; start: number; end: number }

export type ParsedRule = { ok: true; root: RuleGroup } | { ok: false; error: RuleError }

type Kind = 'bool' | 'whole' | 'number' | 'date' | 'text' | 'labels' | 'users' | 'reminders' | 'creator'

/** The fields of section 3.5 and what kind of value each holds. */
export const RULE_FIELDS: Readonly<Record<string, Kind>> = {
  done: 'bool',
  priority: 'whole',
  due_date: 'date',
  start_date: 'date',
  end_date: 'date',
  done_at: 'date',
  created: 'date',
  updated: 'date',
  labels: 'labels',
  project: 'whole',
  assignees: 'users',
  created_by: 'creator',
  reminders: 'reminders',
  percent_done: 'number',
  title: 'text',
  description: 'text',
  hex_color: 'text',
  repeat_after: 'whole',
  id: 'whole',
  index: 'whole',
  project_id: 'whole',
  created_by_id: 'whole',
}

/** Valid on the server but not here; an import removes them (section 3.7). */
export const SERVER_ONLY_FIELDS: ReadonlySet<string> = new Set(['bucket_id', 'position', 'uid'])

const isRange = (op: RuleOp) => op === '>' || op === '>=' || op === '<' || op === '<='
const isList = (op: RuleOp) => op === 'in' || op === 'not in'
const isMany = (kind: Kind) => kind === 'labels' || kind === 'users' || kind === 'reminders'

/** The items of an `in` list, or of a username field, which the server always splits. */
export function termItems(term: RuleTerm): string[] {
  return term.value.split(',').map((item) => item.trim())
}

// --- Parsing ------------------------------------------------------------------------------

class SyntaxProblem extends Error {
  constructor(readonly error: RuleError) {
    super(error.message)
  }
}

const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c)
const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_]/u.test(c)

class Reader {
  i = 0

  constructor(readonly s: string) {}

  fail(message: string, start = this.i, end = Math.min(start + 1, this.s.length)): never {
    throw new SyntaxProblem({ code: 'syntax', message, start, end: Math.max(start, end) })
  }

  skipSpace(): void {
    while (this.i < this.s.length && isSpace(this.s[this.i])) this.i++
  }

  startsWith(text: string, at = this.i): boolean {
    return this.s.startsWith(text, at)
  }

  sequence(depth: number, closing: boolean): RuleGroup {
    if (depth > MAX_RULE_DEPTH) {
      throw new SyntaxProblem({ code: 'too_complex', message: 'The rule has too many groups inside each other.', start: this.i, end: this.i })
    }
    const items: RuleItem[] = []
    // The join read after the last item, waiting for the next one.
    let join: RuleJoin | null = null
    for (;;) {
      this.skipSpace()
      if (this.i >= this.s.length) {
        if (closing) this.fail('A group is missing its closing parenthesis.', this.s.length, this.s.length)
        if (join !== null) this.fail('The rule ends after && or ||.', this.s.length - 2, this.s.length)
        return { kind: 'group', items }
      }
      if (this.s[this.i] === ')') {
        if (!closing) this.fail('There is a closing parenthesis without an opening one.')
        if (items.length === 0) this.fail('A group is empty.')
        if (join !== null) this.fail('A group ends after && or ||.')
        this.i++
        return { kind: 'group', items }
      }
      const atJoin = this.startsWith('&&') || this.startsWith('||')
      if (items.length > 0 && join === null) {
        if (!atJoin) this.fail('Expected && or || here.')
        join = this.s[this.i] === '&' ? 'and' : 'or'
        this.i += 2
        continue
      }
      if (atJoin) {
        this.fail(items.length === 0 ? 'The rule starts with && or ||.' : 'Two joins follow each other.', this.i, this.i + 2)
      }
      let node: RuleTerm | RuleGroup
      if (this.s[this.i] === '(') {
        this.i++
        node = this.sequence(depth + 1, true)
      } else {
        node = this.term()
      }
      items.push({ join: join ?? 'and', node })
      join = null
    }
  }

  term(): RuleTerm {
    const start = this.i
    while (this.i < this.s.length && isWordChar(this.s[this.i])) this.i++
    if (this.i === start) this.fail('Expected a field name here.')
    const field = this.s.slice(start, this.i)
    this.skipSpace()
    const op = this.operator()
    if (op === null) this.fail(`Expected an operator after "${field}".`)
    this.skipSpace()
    const valueStart = this.i
    if (this.i >= this.s.length) this.fail(`"${field} ${op}" needs a value.`, start, this.i)
    const quote = this.s[this.i]
    if (quote === "'" || quote === '"') {
      let out = ''
      this.i++
      for (;;) {
        if (this.i >= this.s.length) this.fail('A quoted value is missing its closing quote.', valueStart, this.s.length)
        const ch = this.s[this.i]
        if (ch === '\\' && this.i + 1 < this.s.length) {
          out += this.s[this.i + 1]
          this.i += 2
          continue
        }
        if (ch === quote) {
          this.i++
          break
        }
        out += ch
        this.i++
      }
      return { kind: 'term', field, op, value: out, quoted: true, start, valueStart, valueEnd: this.i }
    }
    while (this.i < this.s.length && !'&|()'.includes(this.s[this.i])) this.i++
    const raw = this.s.slice(valueStart, this.i)
    const value = raw.trim()
    if (value === '') this.fail(`"${field} ${op}" needs a value.`, start, this.i)
    return { kind: 'term', field, op, value, quoted: false, start, valueStart, valueEnd: valueStart + raw.trimEnd().length }
  }

  private wordAt(word: string, at = this.i): boolean {
    if (!this.s.startsWith(word, at)) return false
    const after = this.s[at + word.length]
    return after === undefined || isSpace(after) || after === "'" || after === '"'
  }

  operator(): RuleOp | null {
    if (this.startsWith('not') && isSpace(this.s[this.i + 3])) {
      let j = this.i + 3
      while (isSpace(this.s[j])) j++
      if (this.wordAt('in', j)) {
        this.i = j + 2
        return 'not in'
      }
    }
    if (this.wordAt('like')) {
      this.i += 4
      return 'like'
    }
    if (this.wordAt('in')) {
      this.i += 2
      return 'in'
    }
    for (const op of ['>=', '<=', '!=', '=', '>', '<'] as const) {
      if (this.startsWith(op)) {
        this.i += op.length
        return op
      }
    }
    return null
  }
}

/** Reads `text`. A blank text is an empty rule. */
export function parseRule(text: string): ParsedRule {
  if (new TextEncoder().encode(text).length > MAX_RULE_BYTES) {
    return { ok: false, error: { code: 'too_complex', message: 'The rule is too long.', start: 0, end: text.length } }
  }
  try {
    return { ok: true, root: new Reader(text).sequence(0, false) }
  } catch (e) {
    if (e instanceof SyntaxProblem) return { ok: false, error: e.error }
    throw e
  }
}

// --- Checking -----------------------------------------------------------------------------

const WHOLE = /^[+-]?\d+$/
const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

function parseBool(text: string): boolean | null {
  switch (text.toLowerCase()) {
    case '1':
    case 't':
    case 'true':
      return true
    case '0':
    case 'f':
    case 'false':
      return false
    default:
      return null
  }
}

function parseWhole(text: string): number {
  return Number.parseInt(text.replace(/^\+/, ''), 10)
}

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

function closestField(field: string): string | null {
  const lower = field.toLowerCase()
  let best: string | null = null
  let bestDistance = Infinity
  for (const name of Object.keys(RULE_FIELDS)) {
    const d = distance(name, lower)
    if (d < bestDistance) {
      best = name
      bestDistance = d
    }
  }
  return bestDistance <= 2 ? best : null
}

function valueReads(kind: Kind, text: string): boolean {
  switch (kind) {
    case 'bool':
      return parseBool(text) !== null
    case 'whole':
    case 'labels':
      return WHOLE.test(text) && text.replace(/^[+-]/, '').length <= 18
    case 'number':
      return NUMBER.test(text)
    case 'date':
    case 'reminders':
      return parseRuleDate(text, new Date(0)) !== null
    default:
      return true
  }
}

function businessDayCount(term: RuleTerm): number {
  const kind = RULE_FIELDS[term.field]
  if (kind !== 'date' && kind !== 'reminders') return 0
  let total = 0
  for (const match of term.value.matchAll(/[+-](\d*)b/g)) {
    total += match[1] === '' ? 1 : Math.min(Number.parseInt(match[1], 10), MAX_BUSINESS_DAYS + 1)
  }
  return total
}

function checkTerm(term: RuleTerm): RuleError | null {
  const error = (code: RuleErrorCode, message: string, start = term.start, end = term.valueEnd): RuleError =>
    ({ code, message, start, end })
  const { field, op } = term
  const kind = Object.prototype.hasOwnProperty.call(RULE_FIELDS, field) ? RULE_FIELDS[field] : undefined
  if (kind === undefined) {
    if (SERVER_ONLY_FIELDS.has(field)) {
      return error('unsupported_field', `Vicu can't check "${field}".`, term.start, term.start + field.length)
    }
    const near = Object.keys(RULE_FIELDS).find((name) => name.toLowerCase() === field.toLowerCase()) ?? closestField(field)
    const hint = near ? ` Did you mean ${near}?` : ''
    return error('unknown_field', `"${field}" is not a field.${hint}`, term.start, term.start + field.length)
  }
  if (op === 'like' && kind !== 'text' && kind !== 'users' && kind !== 'creator') {
    return error('bad_operator', '"like" only works on text, assignees and created_by.')
  }
  if (kind === 'creator' && isRange(op)) return error('bad_operator', 'created_by takes =, !=, in, not in or like.')
  if (op === 'like') return null
  const values = isList(op) || kind === 'users' || kind === 'creator' ? termItems(term) : [term.value]
  let bad: string | null = null
  if (kind === 'users' || kind === 'creator') {
    if (!values.some((value) => value !== '')) bad = term.value
  } else if (kind !== 'text') {
    bad = values.find((value) => !valueReads(kind, value)) ?? null
  }
  if (bad !== null) {
    const what = kind === 'bool' ? 'true or false'
      : kind === 'whole' || kind === 'labels' ? 'a whole number'
        : kind === 'number' ? 'a number'
          : kind === 'date' || kind === 'reminders' ? 'a date, like 2026-10-06 or now+7d'
            : 'a value'
    return error('bad_value', `"${bad}" is not ${what}.`, term.valueStart, term.valueEnd)
  }
  return null
}

/** The first problem in `root`, or null when every term is one section 3.5 allows. */
export function checkRule(root: RuleGroup): RuleError | null {
  let businessDays = 0
  const visit = (group: RuleGroup): RuleError | null => {
    for (const item of group.items) {
      const node = item.node
      if (node.kind === 'group') {
        const problem = visit(node)
        if (problem) return problem
        continue
      }
      const problem = checkTerm(node)
      if (problem) return problem
      businessDays += businessDayCount(node)
      if (businessDays > MAX_BUSINESS_DAYS) {
        return { code: 'too_complex', message: 'The rule adds too many business days.', start: node.start, end: node.valueEnd }
      }
    }
    return null
  }
  return visit(root)
}

/** Parses and checks `text`: the error, or null when the rule is valid (or empty). */
export function validateRule(text: string): RuleError | null {
  const parsed = parseRule(text)
  return parsed.ok ? checkRule(parsed.root) : parsed.error
}

// --- Dates --------------------------------------------------------------------------------

const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/
const FIXED_MINUTE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/
const FIXED_DAY = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/

/** A local wall-clock time, or null when it does not exist as written (a 31 June). */
function localTime(y: number, m: number, d: number, h = 0, mi = 0, s = 0): Date | null {
  const date = new Date(y, m - 1, d, h, mi, s)
  date.setFullYear(y)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
  return date
}

function parseFixed(text: string): Date | null {
  const t = text.trim()
  if (RFC3339.test(t)) {
    const ms = Date.parse(t.toUpperCase())
    return Number.isNaN(ms) ? null : new Date(ms)
  }
  let m = FIXED_MINUTE.exec(t)
  if (m) return localTime(+m[1], +m[2], +m[3], +m[4], +m[5])
  m = FIXED_DAY.exec(t)
  if (m) return localTime(+m[1], +m[2], +m[3])
  return null
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function addMonths(date: Date, months: number): Date {
  // Like a calendar month in the zone: the 31st clamps to the month's last day.
  const day = date.getDate()
  const next = new Date(date)
  next.setDate(1)
  next.setMonth(next.getMonth() + months)
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  next.setDate(Math.min(day, last))
  return next
}

function add(date: Date, amount: number, unit: string): Date | null {
  switch (unit) {
    case 'y':
      return addMonths(date, amount * 12)
    case 'M':
      return addMonths(date, amount)
    case 'w':
      return addDays(date, amount * 7)
    case 'd':
      return addDays(date, amount)
    case 'h':
    case 'H':
      return new Date(date.getTime() + amount * 3_600_000)
    case 'm':
      return new Date(date.getTime() + amount * 60_000)
    case 's':
      return new Date(date.getTime() + amount * 1000)
    case 'b': {
      if (Math.abs(amount) > MAX_BUSINESS_DAYS) return null
      const step = amount < 0 ? -1 : 1
      let moment = date
      for (let n = 0; n < Math.abs(amount); n++) {
        moment = addDays(moment, step)
        while (moment.getDay() === 0 || moment.getDay() === 6) moment = addDays(moment, step)
      }
      return moment
    }
    default:
      return null
  }
}

function roundDown(date: Date, unit: string, weekStart: WeekStart): Date | null {
  const y = date.getFullYear()
  const mo = date.getMonth()
  const d = date.getDate()
  switch (unit) {
    case 'y':
      return new Date(y, 0, 1)
    case 'M':
      return new Date(y, mo, 1)
    case 'w':
      // Weeks start on Monday, or on the account's week start (section 2.1).
      return new Date(y, mo, d - daysIntoWeek(date.getDay() || 7, weekStart))
    case 'd':
      return new Date(y, mo, d)
    case 'h':
    case 'H':
      return new Date(y, mo, d, date.getHours())
    case 'm':
      return new Date(y, mo, d, date.getHours(), date.getMinutes())
    case 's':
      return new Date(y, mo, d, date.getHours(), date.getMinutes(), date.getSeconds())
    default:
      return null
  }
}

/** A date value of section 3.5 at the moment `now`, in the process time zone; null when it does not read. */
export function parseRuleDate(text: string, now: Date, weekStart: WeekStart = getWeekStart()): Date | null {
  const t = text.trim()
  let moment: Date | null
  let steps: string
  if (t.startsWith('now')) {
    moment = new Date(now)
    steps = t.slice(3)
  } else if (t.includes('||')) {
    const at = t.indexOf('||')
    moment = parseFixed(t.slice(0, at))
    if (moment === null) return null
    steps = t.slice(at + 2)
  } else {
    return parseFixed(t)
  }
  let i = 0
  while (i < steps.length) {
    const sign = steps[i]
    if (sign === '/') {
      const unit = steps[i + 1]
      if (unit === undefined || unit === 'b') return null
      moment = roundDown(moment, unit, weekStart)
      if (moment === null) return null
      i += 2
      continue
    }
    if (sign !== '+' && sign !== '-') return null
    let j = i + 1
    while (j < steps.length && /\d/.test(steps[j])) j++
    const amount = j === i + 1 ? 1 : Number.parseInt(steps.slice(i + 1, j), 10)
    const unit = steps[j]
    if (unit === undefined) return null
    moment = add(moment, sign === '-' ? -amount : amount, unit)
    if (moment === null) return null
    i = j + 1
  }
  return moment
}

// --- Evaluating ---------------------------------------------------------------------------

/** The fields of a Vikunja task the rule reads. */
export interface RuleTask {
  id?: number
  title?: string
  description?: string
  done?: boolean
  done_at?: string | null
  due_date?: string | null
  start_date?: string | null
  end_date?: string | null
  created?: string | null
  updated?: string | null
  priority?: number
  percent_done?: number
  project_id: number
  index?: number
  hex_color?: string
  repeat_after?: number
  labels?: Array<{ id: number }> | null
  assignees?: Array<{ username?: string }> | null
  created_by?: { id?: number; username?: string } | null
  reminders?: Array<{ reminder?: string | null }> | null
}

const NULL_DATE_MS = Date.parse('0001-01-01T00:00:00Z')

/** Milliseconds, or null for a missing, null-date or unreadable date. */
function instantOf(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) || ms <= NULL_DATE_MS + 86_400_000 ? null : ms
}

type Check = (task: RuleTask) => boolean

function compare<T extends number | string>(op: RuleOp, left: T, right: T): boolean {
  switch (op) {
    case '=':
    case 'in':
      return left === right
    case '!=':
    case 'not in':
      return left !== right
    case '>':
      return left > right
    case '>=':
      return left >= right
    case '<':
      return left < right
    case '<=':
      return left <= right
    default:
      return false
  }
}

function passes<T extends number | string>(op: RuleOp, value: T, wanted: T[]): boolean {
  if (op === 'in' || op === '=') return wanted.some((w) => w === value)
  if (op === 'not in' || op === '!=') return wanted.every((w) => w !== value)
  return compare(op, value, wanted[0])
}

function dateOf(task: RuleTask, field: string): number | null {
  switch (field) {
    case 'due_date':
      return instantOf(task.due_date)
    case 'start_date':
      return instantOf(task.start_date)
    case 'end_date':
      return instantOf(task.end_date)
    case 'done_at':
      return instantOf(task.done_at)
    case 'created':
      return instantOf(task.created)
    case 'updated':
      return instantOf(task.updated)
    default:
      return null
  }
}

function wholeOf(task: RuleTask, field: string): number {
  switch (field) {
    case 'priority':
      return task.priority ?? 0
    case 'project':
    case 'project_id':
      return task.project_id
    case 'repeat_after':
      return task.repeat_after ?? 0
    case 'id':
      return task.id ?? 0
    case 'index':
      return task.index ?? 0
    case 'created_by_id':
      return task.created_by?.id ?? 0
    default:
      return 0
  }
}

function textOf(task: RuleTask, field: string): string {
  switch (field) {
    case 'title':
      return task.title ?? ''
    case 'description':
      return task.description ?? ''
    case 'hex_color':
      return task.hex_color ?? ''
    default:
      return ''
  }
}

const labelsOf = (task: RuleTask) => (task.labels ?? []).map((label) => label.id)
const assigneesOf = (task: RuleTask) => (task.assignees ?? []).map((person) => person.username ?? '')
const remindersOf = (task: RuleTask) =>
  (task.reminders ?? []).map((r) => instantOf(r.reminder)).filter((ms): ms is number => ms !== null)

function datesOf(term: RuleTerm, now: Date, weekStart: WeekStart = getWeekStart()): number[] {
  const texts = isList(term.op) ? termItems(term) : [term.value]
  return texts.map((text) => (parseRuleDate(text, now, weekStart) as Date).getTime())
}

function many<T extends number | string>(op: RuleOp, nulls: boolean, wanted: T[], of: (task: RuleTask) => T[]): Check {
  return (task) => {
    const values = of(task)
    let hit: boolean
    if (op === '!=' || op === 'not in') hit = values.every((v) => !wanted.includes(v))
    else if (op === '=' || op === 'in') hit = values.some((v) => wanted.includes(v))
    else hit = values.some((v) => compare(op, v, wanted[0]))
    return hit || (nulls && values.length === 0)
  }
}

function manyRange(kind: Kind, run: RuleTerm[], nulls: boolean, now: Date, weekStart: WeekStart = getWeekStart()): Check {
  if (kind === 'labels') {
    const wanted = run.map((t) => [t.op, parseWhole(t.value)] as const)
    return (task) => {
      const values = labelsOf(task)
      return values.some((v) => wanted.every(([op, w]) => compare(op, v, w))) || (nulls && values.length === 0)
    }
  }
  if (kind === 'users') {
    const wanted = run.map((t) => [t.op, termItems(t)[0]] as const)
    return (task) => {
      const values = assigneesOf(task)
      return values.some((v) => wanted.every(([op, w]) => compare(op, v, w))) || (nulls && values.length === 0)
    }
  }
  const wanted = run.map((t) => [t.op, datesOf(t, now, weekStart)[0]] as const)
  return (task) => {
    const values = remindersOf(task)
    return values.some((v) => wanted.every(([op, w]) => compare(op, v, w))) || (nulls && values.length === 0)
  }
}

function compileTerm(term: RuleTerm, kind: Kind, nulls: boolean, now: Date, weekStart: WeekStart = getWeekStart()): Check {
  const { op, field } = term
  const texts = isList(op) ? termItems(term) : [term.value]
  switch (kind) {
    case 'bool': {
      const wanted = texts.map((text) => (parseBool(text) ? 1 : 0))
      return (task) => passes(op, task.done ? 1 : 0, wanted)
    }
    case 'whole': {
      const wanted = texts.map(parseWhole)
      return (task) => {
        const value = wholeOf(task, field)
        return passes(op, value, wanted) || (nulls && value === 0)
      }
    }
    case 'number': {
      const wanted = texts.map(Number)
      return (task) => passes(op, task.percent_done ?? 0, wanted)
    }
    case 'date': {
      const wanted = datesOf(term, now, weekStart)
      return (task) => {
        const value = dateOf(task, field)
        return value === null ? nulls : passes(op, value, wanted)
      }
    }
    case 'text':
      if (op === 'like') {
        const needle = term.value.toLowerCase()
        return (task) => textOf(task, field).toLowerCase().includes(needle)
      }
      return (task) => passes(op, textOf(task, field), texts)
    case 'labels':
      return many(op, nulls, texts.map(parseWhole), labelsOf)
    case 'users':
      return many(op, nulls, termItems(term).filter((item) => item !== ''), assigneesOf)
    case 'reminders':
      return many(op, nulls, datesOf(term, now, weekStart), remindersOf)
    case 'creator': {
      const wanted = termItems(term).filter((item) => item !== '')
      return (task) => {
        const name = task.created_by?.username ?? ''
        return op === '!=' || op === 'not in' ? !wanted.includes(name) : wanted.includes(name)
      }
    }
  }
}

/** Null when nothing in the group counts (every term skipped). */
function compileGroup(group: RuleGroup, nulls: boolean, now: Date, weekStart: WeekStart = getWeekStart()): Check | null {
  const parts: Array<[RuleJoin, Check]> = []
  const items = group.items
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const node = item.node
    if (node.kind === 'group') {
      const inner = compileGroup(node, nulls, now, weekStart)
      if (inner) parts.push([item.join, inner])
      continue
    }
    const kind = RULE_FIELDS[node.field]
    if (node.op === 'like' && (kind === 'users' || kind === 'creator')) continue
    if (isMany(kind) && isRange(node.op)) {
      // Consecutive && range terms on the same field hold for one value together.
      const run = [node]
      while (i + 1 < items.length) {
        const next = items[i + 1]
        if (next.node.kind !== 'term' || next.join !== 'and' || next.node.field !== node.field || !isRange(next.node.op)) break
        run.push(next.node)
        i++
      }
      parts.push([item.join, manyRange(kind, run, nulls, now, weekStart)])
    } else {
      parts.push([item.join, compileTerm(node, kind, nulls, now, weekStart)])
    }
  }
  if (parts.length === 0) return null
  return (task) => {
    let result = parts[0][1](task)
    for (let k = 1; k < parts.length; k++) {
      const [join, check] = parts[k]
      result = join === 'or' ? result || check(task) : result && check(task)
    }
    return result
  }
}

/**
 * The predicate of a rule at `now` (in the process time zone). `includeNulls` is the list's
 * `rule_include_nulls`. An invalid rule matches no task; an empty one every task.
 */
export function compileRule(text: string | null | undefined, includeNulls: boolean, now: Date, weekStart: WeekStart = getWeekStart()): (task: RuleTask) => boolean {
  if (!text || text.trim() === '') return () => true
  const parsed = parseRule(text)
  if (!parsed.ok || checkRule(parsed.root) !== null) return () => false
  return compileGroup(parsed.root, includeNulls, now, weekStart) ?? (() => true)
}

// --- Writing ------------------------------------------------------------------------------

/** `root` without the terms on `fields` and groups left empty; null when nothing changed. */
export function withoutTerms(root: RuleGroup, fields: ReadonlySet<string>): { root: RuleGroup; removed: Set<string> } | null {
  const removed = new Set<string>()
  const strip = (group: RuleGroup): RuleGroup => {
    const kept: RuleItem[] = []
    for (const item of group.items) {
      const node = item.node
      if (node.kind === 'term') {
        if (fields.has(node.field)) removed.add(node.field)
        else kept.push(item)
      } else {
        const inner = strip(node)
        if (inner.items.length > 0) kept.push({ ...item, node: inner })
      }
    }
    return { kind: 'group', items: kept.map((item, index) => (index === 0 ? { ...item, join: 'and' } : item)) }
  }
  const result = strip(root)
  return removed.size === 0 ? null : { root: result, removed }
}

function needsQuotes(value: string, list: boolean): boolean {
  return value === '' || value.startsWith(' ') || value.endsWith(' ') || /[&|()'"\\]/.test(value) || (!list && value.includes(','))
}

/** A value as section 3.7 writes it. */
export function writeRuleValue(value: string, list: boolean): string {
  return needsQuotes(value, list) ? `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : value
}

/** `group` as text, the way section 3.7 writes a rule out. */
export function writeRule(group: RuleGroup): string {
  return group.items.map((item, index) => {
    const join = index === 0 ? '' : item.join === 'or' ? ' || ' : ' && '
    const node = item.node
    if (node.kind === 'group') return `${join}(${writeRule(node)})`
    const value = isList(node.op) ? writeRuleValue(termItems(node).join(', '), true) : writeRuleValue(node.value, false)
    return `${join}${node.field} ${node.op} ${value}`
  }).join('')
}

/** Every term of `text` in source order, for editors; empty when it does not read. */
export function ruleTerms(text: string): RuleTerm[] {
  const parsed = parseRule(text)
  if (!parsed.ok) return []
  const out: RuleTerm[] = []
  const walk = (group: RuleGroup) => {
    for (const item of group.items) {
      if (item.node.kind === 'group') walk(item.node)
      else out.push(item.node)
    }
  }
  walk(parsed.root)
  return out
}

/** Whether `text` has a `like` term (the server cannot be asked for it, section 3.5). */
/**
 * Whether the rule rounds a date to a week (`/w`). With a week start other than Monday the server
 * cannot be asked for such a rule: it has its own week (section 3.5).
 */
export function ruleUsesWeekRounding(text: string | null | undefined): boolean {
  if (!text || text.trim() === '') return false
  return ruleTerms(text).some((term) => term.value.includes('/w'))
}

export function ruleUsesLike(text: string | null | undefined): boolean {
  if (!text || text.trim() === '') return false
  return ruleTerms(text).some((term) => term.op === 'like')
}
