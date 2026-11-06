import { runPlanDaySuite } from './plan-day-suite'

process.env.TZ = 'Pacific/Auckland'
runPlanDaySuite({ zone: 'Pacific/Auckland' })
