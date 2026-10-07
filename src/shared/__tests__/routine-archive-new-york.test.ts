import { runRoutineArchiveSuite } from './routine-archive-suite'

// UTC-4 in October: local evenings are already "tomorrow" in UTC.
process.env.TZ = 'America/New_York'
runRoutineArchiveSuite({ zone: 'America/New_York', expectedOffsetMinutesInOctober: 240 })
