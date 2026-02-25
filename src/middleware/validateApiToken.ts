/**
 * Express middleware that validates an Entra ID access token issued for the
 * application's own API audience (e.g. api://<client-id>/user_access).
 *
 * Protected routes must include an `Authorization: Bearer <token>` header.
 * The middleware verifies:
 *  1. Signature via the Microsoft identity platform JWKS endpoint
 *  2. `aud` (audience) matches the configured API_AUDIENCE
 *  3. `iss` (issuer) matches the configured tenant
 *  4. Token is not expired
 */

import { Request, Response, NextFunction } from 'express';
import jwt, { JwtHeader, JwtPayload, SigningKeyCallback } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { config } from '../config';

const client = jwksClient({
    jwksUri: `https://login.microsoftonline.com/${config.entra.tenantId || 'common'}/discovery/v2.0/keys`,
    cache: true,
    cacheMaxAge: 1800_000, // 30 minutes
    rateLimit: true,
});

function getSigningKey(header: JwtHeader, callback: SigningKeyCallback): void {
    client.getSigningKey(header.kid, (err, key) => {
        if (err) {
            callback(err);
            return;
        }
        callback(null, key?.getPublicKey());
    });
}

function verifyToken(token: string): Promise<JwtPayload> {
    return new Promise((resolve, reject) => {
        jwt.verify(
            token,
            getSigningKey,
            {
                audience: config.apiAudience,
                issuer: config.entra.tenantId
                    ? `https://sts.windows.net/${config.entra.tenantId}/`
                    : undefined,
                algorithms: ['RS256'],
            },
            (err, decoded) => {
                if (err) return reject(err);
                resolve(decoded as JwtPayload);
            },
        );
    });
}

/**
 * Middleware that rejects requests without a valid Bearer token for the API audience.
 */
export async function requireApiToken(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    if (!config.apiAudience) {
        console.warn('API_AUDIENCE is not configured - skipping token validation');
        next();
        return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid Authorization header' });
        return;
    }

    const token = authHeader.slice(7);

    try {
        const claims = await verifyToken(token);
        // Attach claims to the request for downstream use
        (req as any).apiTokenClaims = claims;
        next();
    } catch (err: any) {
        console.error('API token validation failed:', err.message);
        res.status(401).json({ error: 'Invalid or expired access token' });
    }
}
