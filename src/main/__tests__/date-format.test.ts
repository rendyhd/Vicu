import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  locale: { current: 'en-US' },
  sendToAppWindows: vi.fn(),
}))

vi.mock('electron', () => ({ app: { getSystemLocale: () => hoisted.locale.current, getPath: () => '' } }))
vi.mock('../offline/service', () => ({ sendToAppWindows: hoisted.sendToAppWindows }))
vi.mock('../config', () => ({ loadConfig: () => ({ clock_format: 'system' }) }))

import { announceDateFormatIfChanged, currentDateFormat, dateFormatForWindow } from '../date-format'

beforeEach(() => {
  hoisted.locale.current = 'en-US'
  hoisted.sendToAppWindows.mockClear()
})

describe('currentDateFormat', () => {
  it('takes the locale and its hour cycle from the system', () => {
    expect(currentDateFormat({ clock_format: 'system' })).toEqual({ locale: 'en-US', hour12: true })
    hoisted.locale.current = 'en-GB'
    expect(currentDateFormat({ clock_format: 'system' })).toEqual({ locale: 'en-GB', hour12: false })
    expect(currentDateFormat({})).toEqual({ locale: 'en-GB', hour12: false })
  })

  it('lets the Settings choice override the hour cycle only', () => {
    expect(currentDateFormat({ clock_format: '24h' })).toEqual({ locale: 'en-US', hour12: false })
    hoisted.locale.current = 'de-DE'
    expect(currentDateFormat({ clock_format: '12h' })).toEqual({ locale: 'de-DE', hour12: true })
  })
})

describe('announceDateFormatIfChanged', () => {
  it('tells the windows about a changed clock, once, after they asked', () => {
    // The first ask records what the windows know.
    expect(dateFormatForWindow()).toEqual({ locale: 'en-US', hour12: true })

    announceDateFormatIfChanged({ clock_format: 'system' })
    expect(hoisted.sendToAppWindows).not.toHaveBeenCalled()

    announceDateFormatIfChanged({ clock_format: '24h' })
    expect(hoisted.sendToAppWindows).toHaveBeenCalledTimes(1)
    expect(hoisted.sendToAppWindows).toHaveBeenCalledWith('date-format-changed', { locale: 'en-US', hour12: false })

    announceDateFormatIfChanged({ clock_format: '24h' })
    expect(hoisted.sendToAppWindows).toHaveBeenCalledTimes(1)

    announceDateFormatIfChanged({ clock_format: 'system' })
    expect(hoisted.sendToAppWindows).toHaveBeenLastCalledWith('date-format-changed', { locale: 'en-US', hour12: true })
  })
})
