// Which navigations animate (card 4.6). Changing view by pointer cross-fades the content region
// with a short rise; changing it by keyboard (a shortcut, Enter on a sidebar item, Tab and Space) is
// instant, because someone who keeps their hands on the keys should not wait for a transition and
// can repeat the key quickly. The router asks `pageTransitionTypes` for every navigation; the types
// it returns switch on the CSS in assets/index.css (html:active-view-transition-type(page)).

export type InputKind = 'keyboard' | 'pointer'

// Until the first press the app was started or driven from elsewhere (a reminder, the first load):
// no transition.
let lastInput: InputKind = 'keyboard'

export const currentInput = (): InputKind => lastInput

/** Records which kind of input came last; used by the listeners below and by tests. */
export function recordInput(kind: InputKind): void {
  lastInput = kind
}

/** Starts following the last key or pointer press on `target`; returns the function that stops it. */
export function trackInput(target: Pick<Window, 'addEventListener' | 'removeEventListener'>): () => void {
  const onKey = () => recordInput('keyboard')
  const onPointer = () => recordInput('pointer')
  target.addEventListener('keydown', onKey, true)
  target.addEventListener('pointerdown', onPointer, true)
  return () => {
    target.removeEventListener('keydown', onKey, true)
    target.removeEventListener('pointerdown', onPointer, true)
  }
}

export interface NavigationInfo {
  /** Where the router was; absent on the first load. */
  hasFrom: boolean
  /** The page changed (a change of the search string alone, such as typing in Search, does not count). */
  pathChanged: boolean
}

/** The view transition types for a navigation, or false for none. */
export function pageTransitionTypes(info: NavigationInfo, input: InputKind = lastInput): string[] | false {
  return info.hasFrom && info.pathChanged && input === 'pointer' ? ['page'] : false
}
