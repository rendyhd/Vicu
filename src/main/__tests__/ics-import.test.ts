import { runIcsImportSuite } from './ics-import-suite'

// The machine's own time zone (whatever the developer or CI runner uses).
runIcsImportSuite({ zone: 'the system time zone' })
