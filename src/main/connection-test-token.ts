// Settings' "Test Connection" with an empty token field tests the saved token. The saved token only
// goes to the server it was saved for: a different URL with a blank field is tested without one.

function sameServer(a: string, b: string): boolean {
  const clean = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase()
  return clean(a) !== '' && clean(a) === clean(b)
}

export function tokenForConnectionTest(
  url: string,
  typedToken: string,
  savedUrl: string,
  savedToken: string | null | undefined,
): string {
  const typed = typedToken.trim()
  if (typed) return typed
  return savedToken && sameServer(url, savedUrl) ? savedToken : ''
}
