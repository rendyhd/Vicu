// Types of fake-calendar-oauth.mjs for the unit tests.
export interface FakeCalendarProvider {
  origin: string
  state: {
    requests: { method: string; path: string; form?: Record<string, string>; query?: Record<string, string>; prefer?: string | null; auth?: string | null; origin?: string | null }[]
    authorizeError: { error: string; description?: string } | null
    wrongState: boolean
    refreshError: { error: string; error_description?: string } | null
    refreshTokens: Map<string, { provider: string; clientId: string }>
    accessTokens: Set<string>
    revoked: string[]
    googleSecret: string
  }
  endpoints: {
    microsoft: { authorize: string; token: string; api: string }
    google: { authorize: string; token: string; revoke: string; api: string }
  }
  expireAccessTokens(): void
  browse(authorizeUrl: string): Promise<{ status: number; location: string }>
  close(): Promise<void>
}
export function startFakeCalendarProvider(options?: { base?: Date; prefix?: string; pageSize?: number; googleSecret?: string }): Promise<FakeCalendarProvider>
