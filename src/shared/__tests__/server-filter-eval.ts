/**
 * A tiny interpreter for the part of Vikunja's filter language Vicu generates, so tests can
 * check that a server filter string is a superset of what the client-side evaluator accepts.
 *
 * Grammar: `expr := and ('||' and)*`, `and := primary ('&&' primary)*`,
 * `primary := '(' expr ')' | field op value`. Fields: done, project_id, due_date.
 * Anything else throws, so a new clause cannot slip through a test unnoticed.
 */

export interface ServerFilterTask {
  done: boolean
  project_id: number
  due_date: string
}

type Token = { kind: 'punct' | 'op' | 'word' | 'string'; text: string }

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const ch = input[i]
    if (/\s/.test(ch)) { i++; continue }
    if (ch === '(' || ch === ')') { tokens.push({ kind: 'punct', text: ch }); i++; continue }
    if (input.startsWith('&&', i) || input.startsWith('||', i)) { tokens.push({ kind: 'punct', text: input.slice(i, i + 2) }); i += 2; continue }
    const op = ['>=', '<=', '!=', '=', '<', '>'].find((candidate) => input.startsWith(candidate, i))
    if (op) { tokens.push({ kind: 'op', text: op }); i += op.length; continue }
    if (ch === "'") {
      const end = input.indexOf("'", i + 1)
      if (end < 0) throw new Error(`Unterminated string in filter: ${input}`)
      tokens.push({ kind: 'string', text: input.slice(i + 1, end) })
      i = end + 1
      continue
    }
    const word = /^[A-Za-z0-9_.:+-]+/.exec(input.slice(i))
    if (!word) throw new Error(`Unexpected character "${ch}" in filter: ${input}`)
    tokens.push({ kind: 'word', text: word[0] })
    i += word[0].length
  }
  return tokens
}

function compare(op: string, left: number, right: number): boolean {
  switch (op) {
    case '=': return left === right
    case '!=': return left !== right
    case '<': return left < right
    case '<=': return left <= right
    case '>': return left > right
    case '>=': return left >= right
    default: throw new Error(`Unsupported operator ${op}`)
  }
}

function compareField(task: ServerFilterTask, field: string, op: string, value: string): boolean {
  switch (field) {
    case 'done':
      if (op !== '=' && op !== '!=') throw new Error(`Unsupported operator ${op} for done`)
      return compare(op, task.done ? 1 : 0, value === 'true' ? 1 : 0)
    case 'project_id':
      return compare(op, task.project_id, Number(value))
    case 'due_date':
      return compare(op, new Date(task.due_date).getTime(), new Date(value).getTime())
    default:
      throw new Error(`Unsupported filter field ${field}`)
  }
}

/** Parse `filter` once into a predicate. An empty filter passes everything. */
export function compileServerFilter(filter: string | undefined): (task: ServerFilterTask) => boolean {
  if (!filter) return () => true
  const tokens = tokenize(filter)
  let pos = 0

  type Node = (task: ServerFilterTask) => boolean

  const parseOr = (): Node => {
    const nodes = [parseAnd()]
    while (tokens[pos]?.text === '||') { pos++; nodes.push(parseAnd()) }
    return (task) => nodes.some((node) => node(task))
  }
  const parseAnd = (): Node => {
    const nodes = [parsePrimary()]
    while (tokens[pos]?.text === '&&') { pos++; nodes.push(parsePrimary()) }
    return (task) => nodes.every((node) => node(task))
  }
  const parsePrimary = (): Node => {
    const token = tokens[pos]
    if (!token) throw new Error(`Unexpected end of filter: ${filter}`)
    if (token.text === '(' && token.kind === 'punct') {
      pos++
      const inner = parseOr()
      if (tokens[pos]?.text !== ')') throw new Error(`Missing ) in filter: ${filter}`)
      pos++
      return inner
    }
    const field = tokens[pos]
    const op = tokens[pos + 1]
    const value = tokens[pos + 2]
    if (field?.kind !== 'word' || op?.kind !== 'op' || !value || (value.kind !== 'word' && value.kind !== 'string')) {
      throw new Error(`Cannot parse a comparison at token ${pos} of: ${filter}`)
    }
    pos += 3
    return (task) => compareField(task, field.text, op.text, value.text)
  }

  const root = parseOr()
  if (pos !== tokens.length) throw new Error(`Trailing tokens in filter: ${filter}`)
  return root
}

/** Whether `task` passes `filter`. */
export function evaluateServerFilter(filter: string | undefined, task: ServerFilterTask): boolean {
  return compileServerFilter(filter)(task)
}
