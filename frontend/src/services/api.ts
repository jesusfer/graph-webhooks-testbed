// -- Authenticated Fetch for Backend API --
// Wraps the native `fetch` to attach a Bearer token for the app's own API.

import { acquireApiTokenSilent } from './auth';

/**
 * Fetch wrapper that acquires an API access token (silently) and attaches it
 * as a `Bearer` token in the `Authorization` header.
 *
 * Use this for every request to our own `/api/...` endpoints that require
 * authentication. The signature mirrors the native `fetch()`.
 */
export async function callBackend(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const token = await acquireApiTokenSilent();
    const headers = new Headers(init?.headers);
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }
    return fetch(input, { ...init, headers });
}
