export const INVALID_TOTP_ERROR_CODE = 1017
export const USED_TOTP_ERROR_CODE = 1025
export const TOTP_PASSCODE_LENGTH = 6

export interface VikunjaProblem {
  code?: number
  detail?: string
  message?: string
}

export function parseVikunjaProblem(
  text: string,
  status: number
): { errorCode?: number; message: string } {
  let message = `Request failed (${status})`
  let errorCode: number | undefined

  try {
    const parsed = JSON.parse(text) as VikunjaProblem
    if (typeof parsed.code === 'number') errorCode = parsed.code
    if (parsed.detail) {
      message = parsed.detail
    } else if (parsed.message) {
      message = parsed.message
    }
  } catch {
    // Keep the status-based fallback for non-JSON responses.
  }

  return { errorCode, message }
}

export function isTotpChallenge(status: number, errorCode?: number): boolean {
  return status === 412 &&
    (errorCode === INVALID_TOTP_ERROR_CODE || errorCode === USED_TOTP_ERROR_CODE)
}

export function sanitizeTotpCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, TOTP_PASSCODE_LENGTH)
}

export function isTotpCodeComplete(value: string): boolean {
  return /^\d{6}$/.test(value)
}
