import { runPlanDaySuite } from './plan-day-suite'

process.env.TZ = 'America/New_York'
runPlanDaySuite({ zone: 'America/New_York' })
