export interface ApiSuccess<T> {
  success: true
  data: T
}

export interface ApiError {
  success: false
  error: string
  statusCode?: number
  errorCode?: number
}

export type ApiResult<T> = ApiSuccess<T> | ApiError
