import { runProSuite } from './pro-suite'

// The machine's own time zone (whatever the developer or CI runner uses).
runProSuite({ zone: 'the system time zone' })
