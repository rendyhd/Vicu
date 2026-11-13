export interface ApiSuccess<T> {
  success: true
  data: T
  /**
   * Only on a repeating task's completion that was not sent because another device had completed
   * that occurrence already (cross-app semantics 7.5): `data` is the server's task as it is.
   */
  repeatSkipped?: true
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
   * The server answered 2xx with a body that is not JSON: a web page from something in front of
   * Vikunja (a sign-in proxy), not the API. Handled like an unreachable server (see
   * `NOT_API_RESPONSE_MESSAGE` in src/shared/error-classify.ts).
   */
  notApiResponse?: boolean
}

export type ApiResult<T> = ApiSuccess<T> | ApiError
