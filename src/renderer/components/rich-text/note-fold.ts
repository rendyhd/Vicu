/** Long notes fold at about half the visible height, never lower than this. */
export const MIN_NOTE_FOLD = 200

/** Notes this little past the fold show whole: folding them would save less than Show all takes. */
export const NOTE_FOLD_SLACK = 56

export function noteFoldHeight(visibleHeight: number): number {
  return Math.max(MIN_NOTE_FOLD, Math.round(visibleHeight / 2))
}

/** How much of notes [full] tall to show: all of them, or up to [fold] when they are well past it. */
export function shownNoteHeight(full: number, fold: number, open: boolean): number {
  return !open && full > fold + NOTE_FOLD_SLACK ? fold : full
}
