// -- Authentication --
// Handles MSAL authentication and token management

import * as msal from '@azure/msal-browser';
import { AppConfig } from '../types';

interface AuthDeps {
    onAuthStateChanged: () => void;
}

let msalInstance: msal.PublicClientApplication | null = null;
let currentAccount: msal.AccountInfo | null = null;
let accessToken: string = '';
let apiAccessToken: string = '';
let apiScope: string = '';
let deps: AuthDeps;

const DEFAULT_GRAPH_SCOPES = ['User.Read'];
const EXTRA_GRAPH_SCOPES_KEY = 'graph-webhooks-extra-scopes';

export function initAuth(dependencies: AuthDeps): void {
    deps = dependencies;
}

function getExtraGraphScopes(): string[] {
    const stored = localStorage.getItem(EXTRA_GRAPH_SCOPES_KEY);
    if (!stored) return [];
    return stored
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

function saveExtraScopes(scopes: string[]): void {
    localStorage.setItem(EXTRA_GRAPH_SCOPES_KEY, scopes.join(','));
}

export function getAllGraphScopes(): string[] {
    const extra = getExtraGraphScopes();
    const all = [...DEFAULT_GRAPH_SCOPES, ...extra];
    // deduplicate (case-insensitive)
    const seen = new Set<string>();
    return all
        .filter((s) => {
            const lower = s.toLowerCase();
            if (seen.has(lower)) return false;
            seen.add(lower);
            return true;
        })
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export async function initMsal(appConfig: AppConfig): Promise<void> {
    if (!appConfig || !appConfig.clientId) {
        console.warn('App config missing clientId - MSAL will not initialize.');
        return;
    }

    if (!appConfig.apiScope) {
        console.warn('App config missing apiScope - MSAL will not initialize.');
        return;
    }

    if (appConfig.apiScope) {
        apiScope = appConfig.apiScope;
    }

    const msalConfig: msal.Configuration = {
        auth: {
            clientId: appConfig.clientId,
            authority: `https://login.microsoftonline.com/${appConfig.tenantId}`,
            redirectUri: appConfig.redirectUri,
        },
        cache: {
            cacheLocation: 'localStorage',
        },
    };

    msalInstance = new msal.PublicClientApplication(msalConfig);
    await msalInstance.initialize();

    // Handle redirect promise (comes back from login redirect)
    try {
        const response = await msalInstance.handleRedirectPromise();
        if (response) {
            currentAccount = response.account;
            accessToken = response.accessToken;
        }
    } catch (err) {
        console.error('Redirect error:', err);
    }

    // Check for already-signed-in account
    const accounts = msalInstance.getAllAccounts();
    if (accounts.length > 0) {
        currentAccount = accounts[0];
        await acquireApiTokenSilent();
    }
}

export async function acquireGraphTokenSilent(): Promise<string> {
    if (!msalInstance || !currentAccount) return '';
    try {
        const response = await msalInstance.acquireTokenSilent({
            scopes: getAllGraphScopes(),
            account: currentAccount,
        });
        accessToken = response.accessToken;
        return accessToken;
    } catch (err) {
        if (err instanceof msal.InteractionRequiredAuthError) {
            await msalInstance.acquireTokenRedirect({ scopes: getAllGraphScopes() });
        }
        return '';
    }
}

/**
 * Acquire an access token for the backend API (different resource than Graph).
 * Returns the cached token when possible, otherwise performs a silent request.
 */
export async function acquireApiTokenSilent(): Promise<string> {
    if (!msalInstance || !currentAccount || !apiScope) return '';
    try {
        const response = await msalInstance.acquireTokenSilent({
            scopes: [apiScope],
            account: currentAccount,
        });
        apiAccessToken = response.accessToken;
        return apiAccessToken;
    } catch (err) {
        if (err instanceof msal.InteractionRequiredAuthError) {
            await msalInstance.acquireTokenRedirect({ scopes: [apiScope] });
        }
        return '';
    }
}

export async function signIn(): Promise<void> {
    if (!msalInstance) return;
    try {
        const response = await msalInstance.loginPopup({
            scopes: getAllGraphScopes(),
        });
        currentAccount = response.account;
        accessToken = response.accessToken;
        deps.onAuthStateChanged();
    } catch (err) {
        console.error('Login failed:', err);
    }
}

export function signOut(): void {
    if (!msalInstance) return;
    msalInstance.clearCache();
    currentAccount = null;
    accessToken = '';
    deps.onAuthStateChanged();
}

export function getCurrentAccount(): msal.AccountInfo | null {
    return currentAccount;
}

export function getUserId(): string {
    return currentAccount?.localAccountId || currentAccount?.homeAccountId || '';
}

/**
 * Consent to additional Graph scopes via MSAL popup.
 * Merges `newScopes` with existing extra scopes, triggers consent, and persists.
 * Throws on failure so the caller can display the error.
 */
export async function consentToScopes(newScopes: string[]): Promise<void> {
    const existing = getExtraGraphScopes();
    const merged = [...existing, ...newScopes];
    const unique = [...new Set(merged.map((s) => s.trim()))];

    if (!msalInstance || !currentAccount) {
        throw new Error('Cannot consent to scopes: user is not signed in.');
    }

    const allScopes = [...new Set([...DEFAULT_GRAPH_SCOPES, ...unique])];
    const response = await msalInstance.acquireTokenPopup({
        scopes: allScopes,
        account: currentAccount,
    });
    accessToken = response.accessToken;
    saveExtraScopes(unique);
}

export function setupAuthEventHandlers(): void {
    document.getElementById('btn-login-main')!.addEventListener('click', signIn);
}
