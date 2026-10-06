import { runNlpCorpusSuite } from './nlp-corpus-suite'

// UTC-4 in October: local evenings are already "tomorrow" in UTC.
process.env.TZ = 'America/New_York'
runNlpCorpusSuite({ zone: 'America/New_York', expectedOffsetMinutesInOctober: 240 })
