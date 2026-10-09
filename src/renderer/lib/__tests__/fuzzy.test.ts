import { describe, expect, it } from 'vitest'
import { fuzzyRank, fuzzyScore } from '../fuzzy'

describe('fuzzyScore', () => {
  it('matches nothing that lacks the letters in order', () => {
    expect(fuzzyScore('zq', 'Logbook')).toBeNull()
    expect(fuzzyScore('kgo', 'Logbook')).toBeNull()
  })

  it('matches an empty query with zero', () => {
    expect(fuzzyScore('', 'anything')).toBe(0)
  })

  it('ignores case', () => {
    expect(fuzzyScore('LOG', 'logbook')).not.toBeNull()
  })

  it('takes letters in order across the text', () => {
    expect(fuzzyScore('lgbk', 'Logbook')).not.toBeNull()
  })

  it('ranks a prefix above a middle match above a scattered match', () => {
    const prefix = fuzzyScore('log', 'Logbook')!
    const middle = fuzzyScore('log', 'Catalog')!
    const scattered = fuzzyScore('lbk', 'Logbook')!
    expect(prefix).toBeGreaterThan(middle)
    expect(middle).toBeGreaterThan(scattered)
  })

  it('prefers a word start to the middle of a word', () => {
    expect(fuzzyScore('plum', 'Call the plumber')!).toBeGreaterThan(fuzzyScore('lumb', 'Call the plumber')!)
  })

  it('needs every word of the query', () => {
    expect(fuzzyScore('call plumber', 'Call the plumber about the leak')).not.toBeNull()
    expect(fuzzyScore('call dentist', 'Call the plumber about the leak')).toBeNull()
  })

  it('lets shorter text win a tie', () => {
    expect(fuzzyScore('log', 'Log')!).toBeGreaterThan(fuzzyScore('log', 'Log of all the things done')!)
  })
})

describe('fuzzyRank', () => {
  const names = ['Settings', 'Logbook', 'Catalog', 'Upcoming']

  it('returns the matches best first', () => {
    expect(fuzzyRank(names, 'log', (n) => n).map((r) => r.item)).toEqual(['Logbook', 'Catalog'])
  })

  it('keeps the original order for equal scores and honours the limit', () => {
    expect(fuzzyRank(['bb', 'ba', 'bc'], 'b', (n) => n, 2).map((r) => r.item)).toEqual(['bb', 'ba'])
  })

  it('returns everything for an empty query', () => {
    expect(fuzzyRank(names, '', (n) => n)).toHaveLength(4)
  })
})
