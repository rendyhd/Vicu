/**
 * What the server answers to an upload (`POST tasks/{id}/attachments`): 201 even when a file failed,
 * with what it stored in `success` and what it refused in `errors`.
 */
export interface UploadAnswer<T> {
  attachments: T[]
  /** Why a file was refused, when one was. */
  error: string | null
}

export function readUploadAnswer<T = unknown>(data: unknown): UploadAnswer<T> {
  if (typeof data !== 'object' || data === null) return { attachments: [], error: null }
  const { success, errors } = data as { success?: unknown; errors?: unknown }
  const refused = Array.isArray(errors) ? errors[0] : undefined
  const message = typeof refused === 'object' && refused !== null ? (refused as { message?: unknown }).message : undefined
  return {
    attachments: Array.isArray(success) ? (success as T[]) : [],
    error: refused === undefined ? null : typeof message === 'string' && message ? message : 'The server refused the file',
  }
}
