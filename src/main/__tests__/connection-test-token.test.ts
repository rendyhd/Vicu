import { describe, expect, it } from 'vitest'
import { tokenForConnectionTest } from '../connection-test-token'

describe('tokenForConnectionTest', () => {
  it('uses the token that was typed', () => {
    expect(tokenForConnectionTest('https://a.example', ' typed ', 'https://a.example', 'saved')).toBe('typed')
  })

  it('uses the saved token for the saved server when none was typed', () => {
    expect(tokenForConnectionTest('https://a.example', '', 'https://a.example', 'saved')).toBe('saved')
    expect(tokenForConnectionTest('https://A.example/', '  ', 'https://a.example', 'saved')).toBe('saved')
  })

  it('never sends the saved token to another server', () => {
    expect(tokenForConnectionTest('https://other.example', '', 'https://a.example', 'saved')).toBe('')
  })

  it('is empty when nothing is saved', () => {
    expect(tokenForConnectionTest('https://a.example', '', 'https://a.example', null)).toBe('')
  })
})
