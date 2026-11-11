import { runPlanEventsSuite } from './plan-events-suite'

// UTC+13 in October: local mornings are still "yesterday" in UTC. Clock changes on 5 April and 27 September.
process.env.TZ = 'Pacific/Auckland'
runPlanEventsSuite({ zone: 'Pacific/Auckland', expectedOffsetMinutesInOctober: -780 })
