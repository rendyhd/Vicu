import { runDateDisplaySuite } from './date-display-suite'

// UTC+13 in October: local mornings are still "yesterday" in UTC.
process.env.TZ = 'Pacific/Auckland'
runDateDisplaySuite({ zone: 'Pacific/Auckland', expectedOffsetMinutesInOctober: -780 })
