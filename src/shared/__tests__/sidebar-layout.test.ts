import { describe, expect, it } from 'vitest'
import {
  SIDEBAR_BLOCKS,
  SIDEBAR_DEFAULT_ORDER,
  SIDEBAR_VIEWS,
  arrangeableSidebar,
  isDefaultSidebarOrder,
  movedEntry,
  sidebarGroups,
  sidebarOrder,
  sidebarOrderAfterArranging,
  type SidebarEntry,
} from '../sidebar-layout'

const everything = new Set<string>(SIDEBAR_DEFAULT_ORDER)
const without = (...gone: SidebarEntry[]) => new Set<string>(SIDEBAR_DEFAULT_ORDER.filter((entry) => !gone.includes(entry)))

describe('the sidebar order', () => {
  it('the default names every smart list and block once, the Logbook last', () => {
    expect([...SIDEBAR_DEFAULT_ORDER].sort()).toEqual([...SIDEBAR_VIEWS, ...SIDEBAR_BLOCKS].sort())
    expect(SIDEBAR_DEFAULT_ORDER[0]).toBe('inbox')
    expect(SIDEBAR_DEFAULT_ORDER.at(-1)).toBe('logbook')
  })

  it('nothing stored is the default order', () => {
    expect(sidebarOrder(undefined)).toEqual(SIDEBAR_DEFAULT_ORDER)
    expect(sidebarOrder([])).toEqual(SIDEBAR_DEFAULT_ORDER)
    expect(isDefaultSidebarOrder(null)).toBe(true)
    expect(isDefaultSidebarOrder([...SIDEBAR_DEFAULT_ORDER])).toBe(true)
  })

  it('a stored order is kept, each name once, and an unknown name is left out', () => {
    const stored = ['projects', 'calendar', 'inbox', 'projects', 'today', 'plan', 'routines', 'upcoming', 'anytime', 'review', 'logbook', 'pro', 'lists', 'labels']
    expect(sidebarOrder(stored)).toEqual(['projects', 'inbox', 'today', 'plan', 'routines', 'upcoming', 'anytime', 'review', 'logbook', 'pro', 'lists', 'labels'])
    expect(isDefaultSidebarOrder(stored)).toBe(false)
  })

  it('an entry the stored order does not name comes right after the one before it in the default', () => {
    // Saved before Plan and Pro existed, with the Logbook moved up.
    const stored = ['inbox', 'logbook', 'today', 'routines', 'upcoming', 'anytime', 'review', 'projects', 'lists', 'labels']
    expect(sidebarOrder(stored)).toEqual(['inbox', 'logbook', 'today', 'plan', 'routines', 'upcoming', 'anytime', 'review', 'pro', 'projects', 'lists', 'labels'])
    // Nothing before it in the default is stored: it goes first.
    expect(sidebarOrder(['today'])[0]).toBe('inbox')
  })
})

describe('arranging in Settings', () => {
  it('lists only what exists now, in the stored order', () => {
    expect(arrangeableSidebar(undefined, without('plan', 'pro'))).toEqual(['inbox', 'today', 'routines', 'upcoming', 'anytime', 'review', 'projects', 'lists', 'labels', 'logbook'])
  })

  it('the listed entries trade places and an entry that is not listed stays where it was', () => {
    const listed = arrangeableSidebar(undefined, without('plan', 'pro'))
    // The Logbook is dragged to second place.
    const arranged = movedEntry(listed, listed.indexOf('logbook'), 1)
    const stored = sidebarOrderAfterArranging(undefined, arranged)
    expect(stored).toEqual(['inbox', 'logbook', 'plan', 'today', 'routines', 'upcoming', 'anytime', 'pro', 'review', 'projects', 'lists', 'labels'])
    // What Settings shows next is what was dropped.
    expect(arrangeableSidebar(stored, without('plan', 'pro'))).toEqual(arranged)
  })

  it('moving an entry keeps the others in order and ignores a place that does not exist', () => {
    expect(movedEntry(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
    expect(movedEntry(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(movedEntry(['a', 'b'], 0, 2)).toEqual(['a', 'b'])
    expect(movedEntry(['a', 'b'], -1, 0)).toEqual(['a', 'b'])
    expect(movedEntry(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
  })
})

describe('what the sidebar draws', () => {
  it('by default: the lists, Pro, the three blocks, and the Logbook in view at the bottom', () => {
    expect(sidebarGroups(undefined, everything)).toEqual([
      { kind: 'views', views: ['inbox', 'today', 'plan', 'routines', 'upcoming', 'anytime', 'review'], pinned: false },
      { kind: 'block', block: 'pro' },
      { kind: 'block', block: 'projects' },
      { kind: 'block', block: 'lists' },
      { kind: 'block', block: 'labels' },
      { kind: 'views', views: ['logbook'], pinned: true },
    ])
  })

  it('leaves out what is hidden or off, and nothing is left at the bottom then', () => {
    expect(sidebarGroups(undefined, without('logbook', 'pro', 'plan', 'anytime'))).toEqual([
      { kind: 'views', views: ['inbox', 'today', 'routines', 'upcoming', 'review'], pinned: false },
      { kind: 'block', block: 'projects' },
      { kind: 'block', block: 'lists' },
      { kind: 'block', block: 'labels' },
    ])
  })

  it('lists between blocks scroll with them; only the ones under the last block stay in view', () => {
    const stored = ['inbox', 'today', 'projects', 'upcoming', 'anytime', 'lists', 'labels', 'review', 'logbook']
    const groups = sidebarGroups(stored, without('plan', 'routines', 'pro'))
    expect(groups).toEqual([
      { kind: 'views', views: ['inbox', 'today'], pinned: false },
      { kind: 'block', block: 'projects' },
      { kind: 'views', views: ['upcoming', 'anytime'], pinned: false },
      { kind: 'block', block: 'lists' },
      { kind: 'block', block: 'labels' },
      { kind: 'views', views: ['review', 'logbook'], pinned: true },
    ])
  })

  it('the Logbook dragged back among the lists scrolls with them', () => {
    const stored = sidebarOrderAfterArranging(undefined, movedEntry([...SIDEBAR_DEFAULT_ORDER], SIDEBAR_DEFAULT_ORDER.length - 1, 7))
    const groups = sidebarGroups(stored, everything)
    expect(groups[0]).toEqual({ kind: 'views', views: ['inbox', 'today', 'plan', 'routines', 'upcoming', 'anytime', 'review', 'logbook'], pinned: false })
    expect(groups.at(-1)).toEqual({ kind: 'block', block: 'labels' })
  })
})
