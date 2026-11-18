/**
 * Typed errors for the constitution service.
 */
export class ConstitutionError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {object} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ConstitutionError';
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details) {
  throw new ConstitutionError(code, message, details);
}
