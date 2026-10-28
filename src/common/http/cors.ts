/** Headers the browser is allowed to send. Do not add custom auth headers here. */
export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Accept',
  'Authorization',
  'X-Requested-With',
  'Origin',
] as const;

export const CORS_ALLOWED_HEADERS_VALUE = CORS_ALLOWED_HEADERS.join(', ');
