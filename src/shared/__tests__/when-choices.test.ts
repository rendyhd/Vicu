import { runWhenChoicesSuite } from './when-choices-suite'

// The machine's own time zone (whatever the developer or CI runner uses).
runWhenChoicesSuite({ zone: 'the system time zone' })
