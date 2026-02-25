// -- Authentication --
// Handles MSAL authentication and token management

import * as msal from '@azure/msal-browser';
import { AppConfig } from './types';

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

export function getExtraGraphScopes(): string[] {
    const stored = localStorage.getItem(EXTRA_GRAPH_SCOPES_KEY);
    if (!stored) return [];
    return stored
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

export function saveExtraScopes(scopes: string[]): void {
    localStorage.setItem(EXTRA_GRAPH_SCOPES_KEY, scopes.join(','));
}

export function getAllGraphScopes(): string[] {
    const extra = getExtraGraphScopes();
    const all = [...DEFAULT_GRAPH_SCOPES, ...extra];
    // deduplicate (case-insensitive)
    const seen = new Set<string>();
    return all.filter((s) => {
        const lower = s.toLowerCase();
        if (seen.has(lower)) return false;
        seen.add(lower);
        return true;
    });
}

export async function initMsal(appConfig: AppConfig): Promise<void> {
    if (!appConfig || !appConfig.clientId) {
        console.warn('App config missing clientId - MSAL will not initialize.');
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
            storeAuthStateInCookie: false,
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

export function getApiAccessToken(): string {
    return apiAccessToken;
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
    msalInstance.logoutPopup();
    currentAccount = null;
    accessToken = '';
    deps.onAuthStateChanged();
}

export function getAccessToken(): string {
    return accessToken;
}

export function getCurrentAccount(): msal.AccountInfo | null {
    return currentAccount;
}

export function getUserId(): string {
    return currentAccount?.localAccountId || currentAccount?.homeAccountId || '';
}

export function isAuthenticated(): boolean {
    return currentAccount !== null;
}

export function setupAuthEventHandlers(): void {
    document.getElementById('btn-login')!.addEventListener('click', signIn);
    document.getElementById('btn-login-main')!.addEventListener('click', signIn);
    document.getElementById('btn-logout')!.addEventListener('click', signOut);

    // Scopes consent modal
    const scopesModal = document.getElementById('scopes-modal')!;
    const scopesInput = document.getElementById('scopes-input') as HTMLInputElement;
    const currentScopesDiv = document.getElementById('current-scopes')!;

    document.getElementById('btn-consent-scopes')!.addEventListener('click', () => {
        const extra = getExtraGraphScopes();
        scopesInput.value = '';
        currentScopesDiv.innerHTML = `<strong>Current scopes:</strong> ${getAllGraphScopes().join(', ')}`;
        scopesModal.hidden = false;
    });

    document.getElementById('btn-scopes-cancel')!.addEventListener('click', () => {
        scopesModal.hidden = true;
    });

    document.getElementById('btn-scopes-consent')!.addEventListener('click', async () => {
        const raw = scopesInput.value.trim();
        if (!raw) {
            scopesModal.hidden = true;
            return;
        }
        const newScopes = raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        const existing = getExtraGraphScopes();
        const merged = [...existing, ...newScopes];
        // deduplicate
        const unique = [...new Set(merged.map((s) => s.trim()))];
        saveExtraScopes(unique);
        scopesModal.hidden = true;

        // Trigger consent via MSAL popup with the full scope set
        if (msalInstance && currentAccount) {
            try {
                const response = await msalInstance.acquireTokenPopup({
                    scopes: getAllGraphScopes(),
                    account: currentAccount,
                });
                accessToken = response.accessToken;
                alert('Scopes consented successfully.');
            } catch (err) {
                console.error('Consent failed:', err);
                alert('Consent failed. Check the console for details.');
            }
        }
    });

    scopesModal.addEventListener('click', (e) => {
        if (e.target === scopesModal) scopesModal.hidden = true;
    });
}
