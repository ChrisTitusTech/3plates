export type ApiErrorCode =
  | 'invalid_auth'
  | 'invalid_request_payload'
  | 'missing_user_state'
  | 'conflict_or_stale_update'
  | 'internal_error';

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;

  constructor(statusCode: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function invalidAuthError(message = 'Authentication required.') {
  return new ApiError(401, 'invalid_auth', message);
}

export function invalidRequestPayloadError(message = 'Request payload is invalid.') {
  return new ApiError(400, 'invalid_request_payload', message);
}

export function missingUserStateError(message = 'User record is missing.') {
  return new ApiError(404, 'missing_user_state', message);
}

export function conflictOrStaleUpdateError(message = 'The request conflicts with current account state.') {
  return new ApiError(409, 'conflict_or_stale_update', message);
}

export function internalServerError(message = 'An unexpected server error occurred.') {
  return new ApiError(500, 'internal_error', message);
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function serializeApiError(error: ApiError) {
  return {
    ok: false as const,
    error: {
      code: error.code,
      message: error.message,
    },
  };
}