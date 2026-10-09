// The direction a count rolls (card 4.11a): a larger number rolls in from below and pushes the old
// one up, a smaller one rolls in from above. Null when nothing changed. Pure so it can be tested.
export type RollDirection = 'up' | 'down'

export function rollDirection(previous: number, next: number): RollDirection | null {
  if (next === previous) return null
  return next > previous ? 'up' : 'down'
}
