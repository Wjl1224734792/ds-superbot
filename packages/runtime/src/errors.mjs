/** Shared NOT_IMPLEMENTED error for P1+ placeholders. */
export class NotImplementedError extends Error {
  constructor(feature) {
    super(`${feature} is not implemented (P1+)`);
    this.name = 'NotImplementedError';
    this.code = 'NOT_IMPLEMENTED';
  }
}

export function notImplemented(feature) {
  throw new NotImplementedError(feature);
}
