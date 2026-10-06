import { runRoutineArchiveSuite } from './routine-archive-suite'

// UTC+13 in October: local mornings are still "yesterday" in UTC.
process.env.TZ = 'Pacific/Auckland'
runRoutineArchiveSuite({ zone: 'Pacific/Auckland', expectedOffsetMinutesInOctober: -780 })
