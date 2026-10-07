import { runCrossAppSemanticsSuite } from './cross-app-semantics-suite'

// UTC+13 in October: local mornings are still "yesterday" in UTC.
process.env.TZ = 'Pacific/Auckland'
runCrossAppSemanticsSuite({ zone: 'Pacific/Auckland', expectedOffsetMinutesInOctober: -780 })
