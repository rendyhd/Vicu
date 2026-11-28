import { runIcsImportSuite } from './ics-import-suite'

// UTC-4 in October, UTC-5 from 1 November.
process.env.TZ = 'America/New_York'
runIcsImportSuite({ zone: 'America/New_York', expectedOffsetMinutesInOctober: 240 })
