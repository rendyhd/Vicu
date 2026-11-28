import { runPlanEventsSuite } from './plan-events-suite'

// UTC-4 in October. Clock changes on 8 March and 1 November.
process.env.TZ = 'America/New_York'
runPlanEventsSuite({ zone: 'America/New_York', expectedOffsetMinutesInOctober: 240 })
