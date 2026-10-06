import { runNlpCorpusSuite } from './nlp-corpus-suite'

// UTC+13 in October: local mornings are still "yesterday" in UTC.
process.env.TZ = 'Pacific/Auckland'
runNlpCorpusSuite({ zone: 'Pacific/Auckland', expectedOffsetMinutesInOctober: -780 })
