/**
 * The list editor's side of a rule (docs/cross-app-semantics-v1.md, section 3.5): the rule is saved
 * with label and project ids, as Vikunja writes it, and edited with their names. Pure, so both
 * directions and the suggestions are tested without a window. Android has the same in
 * `RuleEditing.kt`.
 */
import { RULE_FIELDS, parseRule, ruleTerms, termItems, validateRule, writeRuleValue, type RuleTerm } from './custom-list-rule'

/** A name and its id, for labels and projects. */
export interface Named { id: number; name: string }

const ID_FIELDS = new Set(['labels', 'project', 'project_id'])

const isList = (term: RuleTerm) => term.op === 'in' || term.op === 'not in'
const itemsOf = (term: RuleTerm) => (isList(term) ? termItems(term) : [term.value])
const isWhole = (value: string) => /^-?\d+$/.test(value)

function rewrite(text: string, replacements: Array<[number, number, string]>): string {
  let out = text
  for (const [start, end, value] of [...replacements].sort((a, b) => b[0] - a[0])) {
    out = out.slice(0, start) + value + out.slice(end)
  }
  return out
}

/** `rule` (with ids) as the editor shows it: ids of known labels and projects become names. */
export function ruleToDisplay(rule: string | undefined, labels: Named[], projects: Named[]): string {
  if (!rule || rule.trim() === '') return ''
  const replacements: Array<[number, number, string]> = []
  for (const term of ruleTerms(rule)) {
    if (!ID_FIELDS.has(term.field) || term.op === 'like') continue
    const known = term.field === 'labels' ? labels : projects
    const items = itemsOf(term)
    const named = items.map((item) => (isWhole(item) ? known.find((entry) => entry.id === Number(item))?.name : undefined) ?? item)
    if (named.every((name, index) => name === items[index])) continue
    replacements.push([term.valueStart, term.valueEnd, writeRuleValue(named.join(', '), isList(term))])
  }
  return rewrite(rule, replacements)
}

/** What the editor saves (`rule`, undefined when empty), or why it cannot (`problem`). */
export type SavedRule = { rule: string | undefined } | { problem: string }

/** The editor's text as the rule to save: names become ids, then the rule is checked. */
export function ruleFromDisplay(text: string, labels: Named[], projects: Named[]): SavedRule {
  if (text.trim() === '') return { rule: undefined }
  const parsed = parseRule(text)
  if (!parsed.ok) return { problem: parsed.error.message }
  const replacements: Array<[number, number, string]> = []
  for (const term of ruleTerms(text)) {
    if (!ID_FIELDS.has(term.field) || term.op === 'like') continue
    const known = term.field === 'labels' ? labels : projects
    const items = itemsOf(term)
    if (items.every(isWhole)) continue
    const ids: number[] = []
    for (const item of items) {
      const id = isWhole(item)
        ? Number(item)
        : (known.find((entry) => entry.name === item) ?? known.find((entry) => entry.name.toLowerCase() === item.toLowerCase()))?.id
      if (id === undefined) {
        return { problem: term.field === 'labels' ? `There is no label named "${item}".` : `There is no project named "${item}".` }
      }
      ids.push(id)
    }
    replacements.push([term.valueStart, term.valueEnd, ids.join(', ')])
  }
  const rule = rewrite(text, replacements).trim()
  const error = validateRule(rule)
  return error ? { problem: error.message } : { rule }
}

/** A suggestion: `label` to show, and the text that replaces `start` until `end`. */
export interface RuleSuggestion { label: string; insert: string; start: number; end: number }

/** The fields offered first, in the order people use them most. */
const COMMON_FIELDS = [
  'done', 'priority', 'due_date', 'labels', 'project', 'assignees', 'title', 'start_date', 'end_date',
  'created', 'updated', 'done_at', 'reminders', 'percent_done', 'description', 'created_by',
]

const OPERATORS = ['=', '!=', '>', '>=', '<', '<=', 'in', 'not in', 'like']

const DATES = ['now', 'now/d', 'now/d+1d', 'now/w', 'now/w+1w', 'now+7d', 'now/M']

/**
 * What fits at `cursor` in `text`: fields at the start of a term, operators after a field, names,
 * dates and true or false after an operator, and joins after a value.
 */
export function suggestRule(text: string, cursor: number, labels: Named[], projects: Named[], limit = 8): RuleSuggestion[] {
  const at = Math.max(0, Math.min(cursor, text.length))
  const before = text.slice(0, at)
  // The term being typed starts after the last join or opening parenthesis.
  const last = Math.max(before.lastIndexOf('&&'), before.lastIndexOf('||'), before.lastIndexOf('('))
  const termStart = last < 0 ? 0 : before.startsWith('(', last) ? last + 1 : last + 2
  const term = before.slice(termStart)
  const fieldMatch = /^\s*([A-Za-z0-9_]+)/.exec(term)
  const field = fieldMatch?.[1]
  const fieldEnd = fieldMatch ? termStart + fieldMatch[0].length : null
  const afterField = fieldEnd !== null ? text.slice(fieldEnd, at) : ''

  const replacingWord = (options: string[], spaceAfter: boolean): RuleSuggestion[] => {
    const word = /[A-Za-z0-9_]*$/.exec(before)?.[0] ?? ''
    const start = at - word.length
    return options
      .filter((option) => option.toLowerCase().startsWith(word.toLowerCase()) && option !== word)
      .map((option) => ({ label: option, insert: spaceAfter ? `${option} ` : option, start, end: at }))
  }

  // Nothing typed in this term yet, or the field name half typed.
  if (field === undefined || (afterField === '' && term.trimEnd() === term)) {
    return replacingWord(COMMON_FIELDS, true).slice(0, limit)
  }
  const kind = RULE_FIELDS[field]
  if (!kind) return []
  const opMatch = /^\s*(not\s+in|like|in|>=|<=|!=|=|>|<)/.exec(afterField)
  if (!opMatch) {
    const allowsLike = kind === 'text' || kind === 'users' || kind === 'creator'
    return OPERATORS.filter((op) => allowsLike || op !== 'like')
      .map((op) => ({ label: op, insert: `${op} `, start: at, end: at }))
      .slice(0, limit)
  }
  const valueText = afterField.slice(opMatch[0].length)
  const typingValue = valueText.trim() === '' || !valueText.endsWith(' ')
  if (typingValue) {
    // In the value: what goes there for this field.
    const item = (valueText.split(',').pop() ?? '').trimStart()
    const start = at - item.length
    const options = kind === 'bool'
      ? ['true', 'false']
      : kind === 'date' || kind === 'reminders'
        ? DATES
        : kind === 'labels'
          ? labels.map((label) => label.name)
          : kind === 'whole' && (field === 'project' || field === 'project_id')
            ? projects.map((project) => project.name)
            : []
    const values = options
      .filter((option) => option.toLowerCase().startsWith(item.toLowerCase()) && option !== item)
      .map((option) => ({ label: option, insert: option, start, end: at }))
    if (values.length > 0 || item === '') return values.slice(0, limit)
  }
  // After a value: a join.
  const gap = before.endsWith(' ') ? '' : ' '
  return ['&&', '||'].map((join) => ({ label: join, insert: `${gap}${join} `, start: at, end: at }))
}
