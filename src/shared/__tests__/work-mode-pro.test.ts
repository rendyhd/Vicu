import { describe, expect, it } from 'vitest'
import { isProEnabled, isProSwitchedOn } from '../pro/settings'

describe('Pro and the Work and Personal mode (contract 22.8)', () => {
  const pro = { pro_enabled: true }

  it('Personal with "Pro only in Work" is Pro off', () => {
    const config = { ...pro, work_mode_enabled: true, work_mode: 'personal', pro_only_in_work: true }
    expect(isProEnabled(config)).toBe(false)
    expect(isProEnabled(config, 'promises')).toBe(false)
  })

  it('Work and All keep Pro on', () => {
    for (const work_mode of ['work', 'all']) {
      expect(isProEnabled({ ...pro, work_mode_enabled: true, work_mode, pro_only_in_work: true })).toBe(true)
    }
  })

  it('the feature off, or the option off, leaves Pro as it was', () => {
    expect(isProEnabled({ ...pro, work_mode_enabled: false, work_mode: 'personal', pro_only_in_work: true })).toBe(true)
    expect(isProEnabled({ ...pro, work_mode_enabled: true, work_mode: 'personal', pro_only_in_work: false })).toBe(true)
  })

  it('the plain switch ignores the mode, and standalone mode is never on', () => {
    const personal = { ...pro, work_mode_enabled: true, work_mode: 'personal', pro_only_in_work: true }
    expect(isProSwitchedOn(personal)).toBe(true)
    expect(isProSwitchedOn({ ...personal, standalone_mode: true })).toBe(false)
    expect(isProSwitchedOn({ pro_enabled: false })).toBe(false)
    expect(isProSwitchedOn(null)).toBe(false)
  })
})
