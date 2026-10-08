import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as lucide from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { SMART_LIST_IDENTITY } from '../smart-list-identity'

// Card 2.4a drift test: the code's identity table equals design-tokens-v1.json `identity`.
const tokens = JSON.parse(readFileSync(resolve(__dirname, '..', '..', '..', '..', 'test-fixtures', 'design-tokens-v1.json'), 'utf8'))
const lists = tokens.identity.lists as Record<string, { color: string; desktopIcon: string }>

describe('smart list identity', () => {
  it('has the same lists as the token file', () => {
    expect(Object.keys(SMART_LIST_IDENTITY).sort()).toEqual(Object.keys(lists).sort())
  })

  it('has the colour and icon name of the token file for every list', () => {
    for (const [id, def] of Object.entries(lists)) {
      const mine = SMART_LIST_IDENTITY[id as keyof typeof SMART_LIST_IDENTITY]
      expect(mine.color, `${id} colour`).toBe(def.color)
      expect(mine.iconName, `${id} icon`).toBe(def.desktopIcon)
    }
  })

  it('uses the lucide component of that name (CircleCheckBig exists in lucide-react 0.400)', () => {
    for (const [id, def] of Object.entries(lists)) {
      const component = (lucide as unknown as Record<string, unknown>)[def.desktopIcon]
      expect(component, `${id} -> ${def.desktopIcon}`).toBeDefined()
      expect(SMART_LIST_IDENTITY[id as keyof typeof SMART_LIST_IDENTITY].icon).toBe(component)
    }
  })

  it('keeps identity colours off role names: they colour icons only', () => {
    expect(tokens.identity.about).toMatch(/only ever colour list icons/)
    for (const def of Object.values(lists)) expect(def.color).toMatch(/^#[0-9A-F]{6}$/)
  })
})
