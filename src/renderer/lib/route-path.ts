/**
 * The path of the page being shown, read from the router when it is needed. `useMatches()` would
 * subscribe the calling component to every navigation; a mutation hook that only needs the path at
 * the moment it runs (every row's checkbox has one) reads it here instead (D-REN-5).
 */
export function currentPathname(router: { state: { matches: ReadonlyArray<{ pathname: string }> } }): string {
  const matches = router.state.matches
  return matches[matches.length - 1]?.pathname ?? ''
}
