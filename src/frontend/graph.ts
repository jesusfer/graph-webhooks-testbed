// -- Authenticated Fetch for Microsoft Graph --
// Wraps the native `fetch` to attach a Bearer token and default headers for Graph API calls.

import { acquireGraphTokenSilent } from './auth';

const GRAPH_BASE_URL = 'https://graph.microsoft.com';

/**
 * Fetch wrapper for Microsoft Graph API calls.
 *
 * - Silently acquires a Graph access token and sets the `Authorization` header.
 * - Sets `Content-Type: application/json` by default (can be overridden).
 * - Prefixes relative paths with the Graph base URL (e.g. `"/v1.0/me"` →
 *   `"https://graph.microsoft.com/v1.0/me"`).
 * - Any additional headers supplied via `init.headers` are merged in and take
 *   precedence over the defaults.
 */
export async function graphFetch(path: string, init?: RequestInit): Promise<Response> {
    const token = await acquireGraphTokenSilent();

    const headers = new Headers();
    headers.set('Content-Type', 'application/json');

    // Apply caller-supplied headers (may override defaults)
    if (init?.headers) {
        const extra = new Headers(init.headers);
        extra.forEach((value, key) => headers.set(key, value));
    }

    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    const url = path.startsWith('http') ? path : `${GRAPH_BASE_URL}${path}`;

    return fetch(url, { ...init, headers });
}
