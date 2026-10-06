import { runCrossAppSemanticsSuite } from './cross-app-semantics-suite'

// The machine's own time zone (whatever the developer or CI runner uses).
runCrossAppSemanticsSuite({ zone: 'the system time zone' })
