// Routines on Today (docs/cross-app-semantics-v1.md section 6.10): one row per routine for its
// earliest open time today, which rows are due now, how many show, and the line behind which the
// rest wait. Pure, the same rules as the Android `TodayRoutines.kt`; the `todayRoutines` vectors of
// the fixture pin it.

/** A row is due now when its time is at most this many minutes away, or has passed. */
export const TODAY_ROUTINES_SOON_MINUTES = 120

/** The due-now rows shown unless the user changed it. */
export const TODAY_ROUTINES_DEFAULT_LIMIT = 2

/** The limits Settings offers; 'all' shows every due-now row. */
export const TODAY_ROUTINES_LIMITS = [1, 2, 3, 5, 'all'] as const
export type TodayRoutinesLimit = (typeof TODAY_ROUTINES_LIMITS)[number]

/** A stored limit, or the default for a missing or unknown one. */
export function todayRoutinesLimit(value: unknown): TodayRoutinesLimit {
  return (TODAY_ROUTINES_LIMITS as readonly unknown[]).includes(value)
    ? (value as TodayRoutinesLimit)
    : TODAY_ROUTINES_DEFAULT_LIMIT
}

/** A routine's row: the occurrence it stands for and how far the routine is today. */
export interface TodayRoutineRow<T> {
  item: T
  routineId: string
  minutes: number
  finished: number
  total: number
  dueNow: boolean
  /** `1/3` when the routine has more than one time today. */
  progress: string | null
}

export interface TodayRoutinesPlan<T> {
  /** Every row, in order. */
  rows: TodayRoutineRow<T>[]
  /** The rows shown while the line is closed. */
  visible: TodayRoutineRow<T>[]
  /** The rows behind the line. */
  hidden: TodayRoutineRow<T>[]
  /** The closed line: `2 later today` or `Show 3 more`; null when nothing is behind it. */
  lineText: string | null
}

export interface TodayRoutineItem {
  routineId: string
  name: string
  minutes: number
  finished: boolean
  /** An after_completion occurrence carried to today from an earlier date. */
  carried: boolean
}

export function planTodayRoutines<T>(
  items: T[],
  nowMinutes: number,
  limit: TodayRoutinesLimit,
  read: (item: T) => TodayRoutineItem,
): TodayRoutinesPlan<T> {
  const byRoutine = new Map<string, { item: T; info: TodayRoutineItem }[]>()
  for (const item of items) {
    const info = read(item)
    const group = byRoutine.get(info.routineId)
    if (group) group.push({ item, info })
    else byRoutine.set(info.routineId, [{ item, info }])
  }

  const rows: (TodayRoutineRow<T> & { name: string })[] = []
  for (const [routineId, occurrences] of byRoutine) {
    let next: { item: T; info: TodayRoutineItem } | undefined
    for (const occurrence of occurrences) {
      if (occurrence.info.finished) continue
      if (!next || occurrence.info.minutes < next.info.minutes) next = occurrence
    }
    if (!next) continue
    const finished = occurrences.filter((occurrence) => occurrence.info.finished).length
    const total = occurrences.length
    rows.push({
      item: next.item,
      routineId,
      name: next.info.name.toLowerCase(),
      minutes: next.info.minutes,
      finished,
      total,
      dueNow: next.info.carried || next.info.minutes <= nowMinutes + TODAY_ROUTINES_SOON_MINUTES,
      progress: total > 1 ? `${finished}/${total}` : null,
    })
  }
  rows.sort((left, right) => left.minutes - right.minutes || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))

  const ordered: TodayRoutineRow<T>[] = rows.map(({ name: _name, ...row }) => row)
  const dueNow = ordered.filter((row) => row.dueNow)
  const visible = limit === 'all' ? dueNow : dueNow.slice(0, limit)
  const hidden = ordered.filter((row) => !visible.includes(row))
  const lineText = hidden.length === 0
    ? null
    : hidden.some((row) => row.dueNow) ? `Show ${hidden.length} more` : `${hidden.length} later today`
  return { rows: ordered, visible, hidden, lineText }
}
