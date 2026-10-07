import { runCrossAppSemanticsSuite } from './cross-app-semantics-suite'

// UTC-4 in October: local evenings are already "tomorrow" in UTC, which broke every
// UTC-based date computation.
process.env.TZ = 'America/New_York'
runCrossAppSemanticsSuite({ zone: 'America/New_York', expectedOffsetMinutesInOctober: 240 })
