import { runProSuite } from './pro-suite'

// UTC-5 in November: local evenings are already "tomorrow" in UTC.
process.env.TZ = 'America/New_York'
runProSuite({ zone: 'America/New_York', expectedOffsetMinutesInNovember: 300 })
