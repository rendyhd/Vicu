const DAY = 86400
const WEEK = 604800
const YEAR = 365 * DAY

export type RecurrencePreset = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' | 'none'

interface RecurrenceValues {
  repeat_after: number
  repeat_mode: number
}

const presets: Record<Exclude<RecurrencePreset, 'custom' | 'none'>, RecurrenceValues> = {
  daily: { repeat_after: DAY, repeat_mode: 0 },
  weekly: { repeat_after: WEEK, repeat_mode: 0 },
  monthly: { repeat_after: 0, repeat_mode: 1 },
  yearly: { repeat_after: YEAR, repeat_mode: 0 },
}

export function getPresetValues(preset: Exclude<RecurrencePreset, 'custom' | 'none'>): RecurrenceValues {
  return presets[preset]
}

export function detectRecurrencePreset(repeatAfter: number, repeatMode: number): RecurrencePreset {
  if (repeatAfter === 0 && repeatMode === 0) return 'none'
  if (repeatMode === 1 && repeatAfter === 0) return 'monthly'
  if (repeatAfter === DAY && repeatMode === 0) return 'daily'
  if (repeatAfter === WEEK && repeatMode === 0) return 'weekly'
  if (repeatAfter === YEAR && repeatMode === 0) return 'yearly'
  return 'custom'
}

export function formatRecurrenceLabel(repeatAfter: number, repeatMode: number): string {
  const preset = detectRecurrencePreset(repeatAfter, repeatMode)
  if (preset === 'none') return ''
  if (preset !== 'custom') return preset.charAt(0).toUpperCase() + preset.slice(1)

  if (repeatMode === 1) return 'Monthly (custom)'
  if (repeatMode === 2) return formatInterval(repeatAfter) + ' (from completion)'

  return formatInterval(repeatAfter)
}

function formatInterval(seconds: number): string {
  if (seconds % YEAR === 0) {
    const n = seconds / YEAR
    return n === 1 ? 'Yearly' : `Every ${n} years`
  }
  if (seconds % WEEK === 0) {
    const n = seconds / WEEK
    return n === 1 ? 'Weekly' : `Every ${n} weeks`
  }
  if (seconds % DAY === 0) {
    const n = seconds / DAY
    return n === 1 ? 'Daily' : `Every ${n} days`
  }
  const hours = Math.round(seconds / 3600)
  return `Every ${hours} hours`
}
