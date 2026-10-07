import { runNlpCorpusSuite } from './nlp-corpus-suite'

// The machine's own time zone (whatever the developer or CI runner uses).
runNlpCorpusSuite({ zone: 'the system time zone' })
