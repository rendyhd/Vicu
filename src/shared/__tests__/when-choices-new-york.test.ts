import { runWhenChoicesSuite } from './when-choices-suite'

// UTC-4 in October. Clock changes on 8 March and 1 November.
process.env.TZ = 'America/New_York'
runWhenChoicesSuite({ zone: 'America/New_York' })
