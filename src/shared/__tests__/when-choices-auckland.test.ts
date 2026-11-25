import { runWhenChoicesSuite } from './when-choices-suite'

// UTC+13 in October. Clock changes on 5 April and 27 September.
process.env.TZ = 'Pacific/Auckland'
runWhenChoicesSuite({ zone: 'Pacific/Auckland' })
