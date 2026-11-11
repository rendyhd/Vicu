import { runPlanEventsSuite } from './plan-events-suite'

// The machine's own time zone (whatever the developer or CI runner uses).
runPlanEventsSuite({ zone: 'the system time zone' })
