import { config } from '../config';

const GRAPH_BASE_URL = 'https://graph.microsoft.com';

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/**
 * Acquire an app-only token using the client_credentials flow.
 * Caches the token until 5 minutes before expiry.
 */
export async function acquireAppToken(): Promise<string> {
    if (cachedToken && Date.now() < tokenExpiresAt) {
        return cachedToken;
    }

    const tokenUrl = `https://login.microsoftonline.com/${config.entra.tenantId}/oauth2/v2.0/token`;

    const body = new URLSearchParams({
        client_id: config.entra.clientId,
        client_secret: config.entra.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
    });

    const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Failed to acquire app token (${res.status}): ${errText}`);
    }

    const json = (await res.json()) as { access_token: string; expires_in: number };
    cachedToken = json.access_token;
    // Expire 5 minutes early to avoid edge-case failures
    tokenExpiresAt = Date.now() + (json.expires_in - 300) * 1000;
    return cachedToken;
}

/**
 * Fetch wrapper for Microsoft Graph using app-only (client_credentials) auth.
 *
 * - Automatically acquires and attaches a Bearer token.
 * - Sets `Content-Type: application/json` by default.
 * - Prefixes relative paths with the Graph base URL
 *   (e.g. `"/v1.0/subscriptions"` → `"https://graph.microsoft.com/v1.0/subscriptions"`).
 */
export async function callGraph(path: string, init?: RequestInit): Promise<Response> {
    const token = await acquireAppToken();

    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('Authorization', `Bearer ${token}`);

    // Apply caller-supplied headers (may override defaults)
    if (init?.headers) {
        const extra = new Headers(init.headers);
        extra.forEach((value, key) => headers.set(key, value));
    }

    const url = path.startsWith('http') ? path : `${GRAPH_BASE_URL}${path}`;

    console.info(`Graph call: ${init?.method || 'GET'} ${url}`);

    return fetch(url, { ...init, headers });
}
