import { runTimeBlocksSuite } from './time-blocks-suite'

// The machine's own time zone (whatever the developer or CI runner uses).
runTimeBlocksSuite({ zone: 'the system time zone' })
