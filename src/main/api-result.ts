export interface ApiSuccess<T> {
  success: true
  data: T
  /**
   * Only on a repeating task's completion that was not sent because another device had completed
   * that occurrence already (cross-app semantics 7.5): `data` is the server's task as it is.
   */
  repeatSkipped?: true
  /**
   * Only on a task update whose notes were also changed on another device since this one read them
   * (description format, "Notes changed in two places"): both versions were sent, and `data` is the
   * server's task with the merged notes.
   */
  notesMerged?: true
}

export interface ApiError {
  success: false
  error: string
  statusCode?: number
  errorCode?: number
  /**
   * The session works, but the API token it uses lacks the permission for this request (Vikunja
   * answers that with 401; cross-app semantics 9.7). Sent on as a 403 with a message that says so.
   */
  tokenPermission?: boolean
  /**
   * The answer was a web page from something in front of Vikunja, not the API: 2xx with a body that
   * is not JSON (a sign-in proxy), or a 4xx with one (a network's sign-in page, a firewall). Handled
   * like an unreachable server; a 4xx of this kind carries no `statusCode` (see
   * `NOT_API_RESPONSE_MESSAGE` and `isNotApiErrorAnswer` in src/shared/error-classify.ts).
   */
  notApiResponse?: boolean
}

export type ApiResult<T> = ApiSuccess<T> | ApiError
