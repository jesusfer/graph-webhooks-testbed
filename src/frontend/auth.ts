// -- Authentication --
// Handles MSAL authentication and token management

import * as msal from '@azure/msal-browser';

interface AppConfig {
    clientId: string;
    tenantId: string;
    redirectUri: string;
    graphNotificationUrl: string;
    hasEncryptionCertificate: boolean;
    encryptionCertificate: string;
}

interface AuthDeps {
    onAuthStateChanged: () => void;
}

let msalInstance: msal.PublicClientApplication | null = null;
let currentAccount: msal.AccountInfo | null = null;
let accessToken: string = '';
let deps: AuthDeps;

const DEFAULT_SCOPES = ['User.Read'];
const EXTRA_SCOPES_KEY = 'graph-webhooks-extra-scopes';

export function initAuth(dependencies: AuthDeps): void {
    deps = dependencies;
}

export function getExtraScopes(): string[] {
    const stored = localStorage.getItem(EXTRA_SCOPES_KEY);
    if (!stored) return [];
    return stored
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

export function saveExtraScopes(scopes: string[]): void {
    localStorage.setItem(EXTRA_SCOPES_KEY, scopes.join(','));
}

export function getAllScopes(): string[] {
    const extra = getExtraScopes();
    const all = [...DEFAULT_SCOPES, ...extra];
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
        console.warn('App config missing clientId – MSAL will not initialize.');
        return;
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
        await acquireTokenSilent();
    }
}

export async function acquireTokenSilent(): Promise<string> {
    if (!msalInstance || !currentAccount) return '';
    try {
        const response = await msalInstance.acquireTokenSilent({
            scopes: getAllScopes(),
            account: currentAccount,
        });
        accessToken = response.accessToken;
        return accessToken;
    } catch (err) {
        if (err instanceof msal.InteractionRequiredAuthError) {
            await msalInstance.acquireTokenRedirect({ scopes: getAllScopes() });
        }
        return '';
    }
}

export async function signIn(): Promise<void> {
    if (!msalInstance) return;
    try {
        const response = await msalInstance.loginPopup({
            scopes: getAllScopes(),
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
        const extra = getExtraScopes();
        scopesInput.value = '';
        currentScopesDiv.innerHTML = `<strong>Current scopes:</strong> ${getAllScopes().join(', ')}`;
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
        const existing = getExtraScopes();
        const merged = [...existing, ...newScopes];
        // deduplicate
        const unique = [...new Set(merged.map((s) => s.trim()))];
        saveExtraScopes(unique);
        scopesModal.hidden = true;

        // Trigger consent via MSAL popup with the full scope set
        if (msalInstance && currentAccount) {
            try {
                const response = await msalInstance.acquireTokenPopup({
                    scopes: getAllScopes(),
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
