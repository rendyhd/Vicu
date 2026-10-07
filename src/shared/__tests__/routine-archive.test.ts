import { runRoutineArchiveSuite } from './routine-archive-suite'

// The machine's own time zone (whatever the developer or CI runner uses).
runRoutineArchiveSuite({ zone: 'the system time zone' })
