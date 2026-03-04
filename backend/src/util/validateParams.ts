/**
 * Parameter-validation helpers used by route handlers to guard against
 * injection attacks.  Every function either returns a sanitised value or
 * throws a `ValidationError` that the caller can map to a 400 response.
 */

// GUID / UUID v4 – 8-4-4-4-12 hex digits, case-insensitive
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Microsoft Graph change-type values that can be combined with commas.
 * e.g. "created", "updated,deleted"
 */
const CHANGE_TYPE_TOKENS = new Set(['created', 'updated', 'deleted']);

/**
 * Allowed characters in a Graph resource path.
 * Letters, digits, and a restricted set of URL / OData characters.
 */
const RESOURCE_PATH_RE = /^[a-zA-Z0-9\-._~:/?#\[\]@!$&'()*+,;=% ]+$/;

export class ValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ValidationError';
    }
}

/**
 * Validate that `value` is a well-formed GUID / UUID and return the
 * lower-cased canonical form.
 */
export function asGuid(value: unknown, label: string): string {
    const str = typeof value === 'string' ? value.trim() : '';
    if (!GUID_RE.test(str)) {
        throw new ValidationError(`${label} must be a valid GUID (received "${str}")`);
    }
    return str.toLowerCase();
}

/**
 * Validate and return a positive integer for `expirationMinutes`-style
 * parameters.  Falls back to `defaultValue` when the input is missing or
 * not a valid number.  Clamps to [1, maxValue].
 */
export function asPositiveInt(
    value: unknown,
    label: string,
    defaultValue: number,
    maxValue = 43200, // 30 days in minutes
): number {
    if (value === undefined || value === null || value === '') return defaultValue;
    const n = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (Number.isNaN(n) || n < 1) {
        throw new ValidationError(`${label} must be a positive integer`);
    }
    return Math.min(n, maxValue);
}

/**
 * Validate a Microsoft Graph `changeType` value.
 * Accepts a comma-separated list of allowed tokens (e.g. "created,updated").
 */
export function asChangeType(value: unknown, label: string): string {
    const str = typeof value === 'string' ? value.trim() : '';
    if (!str) {
        throw new ValidationError(`${label} is required`);
    }
    const tokens = str.split(',').map((t) => t.trim().toLowerCase());
    for (const token of tokens) {
        if (!CHANGE_TYPE_TOKENS.has(token)) {
            throw new ValidationError(`${label} contains an invalid change type "${token}"`);
        }
    }
    return tokens.join(',');
}

/**
 * Validate a Microsoft Graph resource path.
 * Only URL-safe characters are allowed; the value must not be empty.
 */
export function asResourcePath(value: unknown, label: string): string {
    const str = typeof value === 'string' ? value.trim() : '';
    if (!str || str.length > 1024) {
        throw new ValidationError(`${label} must be a non-empty string up to 1024 characters`);
    }
    if (!RESOURCE_PATH_RE.test(str)) {
        throw new ValidationError(`${label} contains invalid characters`);
    }
    return str;
}
