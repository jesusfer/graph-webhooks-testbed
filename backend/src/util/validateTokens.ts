/**
 * Validate the JWT tokens found in the `validationTokens` array
 * of a Microsoft Graph webhook notification payload.
 *
 * Checks performed on each token:
 *  1. Token has not expired
 *  2. Token is signed by Microsoft (signature verified via JWKS)
 *  3. The `azp` (authorized party) claim is exactly the Graph Change Tracking app ID
 *  4. The `aud` (audience) claim matches the configured application client ID
 *
 * Aggregate check:
 *  - At least one token must have a `tid` (tenant ID) that matches the configured tenant.
 */

import jwt, { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { config } from '../config';

/** The well-known app ID for Microsoft Graph Change Tracking. */
const GRAPH_CHANGE_TRACKING_APP_ID = '0bf30f3b-4a52-48df-9a82-234910c4a086';

/** Microsoft identity platform JWKS endpoint (common / multi-tenant). */
const MS_JWKS_URI = 'https://login.microsoftonline.com/common/discovery/v2.0/keys';

const client = jwksClient({
    jwksUri: MS_JWKS_URI,
    cache: true,
    cacheMaxAge: 600_000, // 10 minutes
    rateLimit: true,
});

function getSigningKey(header: JwtHeader, callback: SigningKeyCallback): void {
    client.getSigningKey(header.kid, (err, key) => {
        if (err) {
            callback(err);
            return;
        }
        const signingKey = key?.getPublicKey();
        callback(null, signingKey);
    });
}

export interface TokenValidationResult {
    /** Overall pass/fail for the entire set of validation tokens. */
    valid: boolean;
    /** Human-readable summary of the validation outcome. */
    summary: string;
    /** Per-token details. */
    tokens: SingleTokenResult[];
}

export interface SingleTokenResult {
    /** Whether this individual token passed all checks. */
    valid: boolean;
    /** Reason for failure, if any. */
    error?: string;
    /** Decoded claims (only set when the token is structurally valid). */
    claims?: Record<string, unknown>;
}

/**
 * Validate an array of JWT validation tokens included in a Graph notification payload.
 *
 * @param tokens   The `validationTokens` string array from the notification body.
 * @returns        A {@link TokenValidationResult} summarising the outcome.
 */
export async function validateNotificationTokens(tokens: string[]): Promise<TokenValidationResult> {
    const expectedAudience = config.entra.clientId;
    const expectedTenantId = config.entra.tenantId;

    if (!expectedAudience) {
        return {
            valid: false,
            summary: 'Cannot validate tokens: ENTRA_CLIENT_ID is not configured',
            tokens: [],
        };
    }

    const results: SingleTokenResult[] = await Promise.all(
        tokens.map((token) => validateSingleToken(token, expectedAudience)),
    );

    // Aggregate: all individual tokens must be valid ...
    const allValid = results.length > 0 && results.every((r) => r.valid);

    // ... and at least one must belong to our tenant
    const hasTenantMatch =
        !expectedTenantId ||
        results.some((r) => r.valid && (r.claims?.tid as string) === expectedTenantId);

    const valid = allValid && hasTenantMatch;

    let summary: string;
    if (valid) {
        summary = `All ${results.length} validation token(s) passed`;
    } else if (!allValid) {
        const failed = results.filter((r) => !r.valid).length;
        summary = `${failed} of ${results.length} validation token(s) failed`;
    } else {
        summary = `No validation token matched the configured tenant ID (${expectedTenantId})`;
    }

    return { valid, summary, tokens: results };
}

/**
 * Verify a single JWT against Microsoft's JWKS, then assert the expected claims.
 */
async function validateSingleToken(
    token: string,
    expectedAudience: string,
): Promise<SingleTokenResult> {
    try {
        const decoded = await new Promise<Record<string, unknown>>((resolve, reject) => {
            jwt.verify(
                token,
                getSigningKey,
                {
                    algorithms: ['RS256'],
                    // We check audience ourselves for a clearer error message
                },
                (err, payload) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(payload as Record<string, unknown>);
                    }
                },
            );
        });

        // Check appid claim
        if (decoded.appid !== GRAPH_CHANGE_TRACKING_APP_ID) {
            return {
                valid: false,
                error: `appid claim "${decoded.appid}" does not match expected "${GRAPH_CHANGE_TRACKING_APP_ID}"`,
                claims: decoded,
            };
        }

        // Check audience claim
        const aud = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
        if (!aud.includes(expectedAudience)) {
            return {
                valid: false,
                error: `aud claim [${aud.join(', ')}] does not include expected "${expectedAudience}"`,
                claims: decoded,
            };
        }

        return { valid: true, claims: decoded };
    } catch (err: any) {
        // jwt.verify already checks expiration; surface a friendly message
        const message =
            err.name === 'TokenExpiredError'
                ? 'Token has expired'
                : err.name === 'JsonWebTokenError'
                  ? `Invalid token: ${err.message}`
                  : (err.message ?? String(err));

        return { valid: false, error: message };
    }
}
