import { runIcsImportSuite } from './ics-import-suite'

// UTC+13 in October and November.
process.env.TZ = 'Pacific/Auckland'
runIcsImportSuite({ zone: 'Pacific/Auckland', expectedOffsetMinutesInOctober: -780 })
