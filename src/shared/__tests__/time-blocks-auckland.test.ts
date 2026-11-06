import { runTimeBlocksSuite } from './time-blocks-suite'

// UTC+13 in October: local mornings are still "yesterday" in UTC.
process.env.TZ = 'Pacific/Auckland'
runTimeBlocksSuite({ zone: 'Pacific/Auckland', expectedOffsetMinutesInOctober: -780 })
