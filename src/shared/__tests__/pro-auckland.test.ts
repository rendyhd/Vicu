import { runProSuite } from './pro-suite'

// UTC+13 in November: local mornings are still "yesterday" in UTC.
process.env.TZ = 'Pacific/Auckland'
runProSuite({ zone: 'Pacific/Auckland', expectedOffsetMinutesInNovember: -780 })
