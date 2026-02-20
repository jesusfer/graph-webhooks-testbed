import * as msal from '@azure/msal-browser';

// ── Types ──

interface AppConfig {
    clientId: string;
    tenantId: string;
    redirectUri: string;
    graphNotificationUrl: string;
}

interface SubscriptionRecord {
    partitionKey: string;
    rowKey: string;
    resource: string;
    changeType: string;
    expirationDateTime: string;
    notificationUrl: string;
    createdAt: string;
    lastNotificationAt?: string;
}

interface NotificationRecord {
    partitionKey: string;
    rowKey: string;
    subscriptionId: string;
    receivedAt: string;
    body: string;
}

// ── State ──

let msalInstance: msal.PublicClientApplication | null = null;
let currentAccount: msal.AccountInfo | null = null;
let appConfig: AppConfig | null = null;
let accessToken: string = '';

const GRAPH_SCOPES = ['User.Read',"Mail.Read"];

// ── Bootstrap ──

async function init(): Promise<void> {
    // Fetch server-side config
    const res = await fetch('/api/config');
    appConfig = await res.json();

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

    setupUI();
}

async function acquireTokenSilent(): Promise<string> {
    if (!msalInstance || !currentAccount) return '';
    try {
        const response = await msalInstance.acquireTokenSilent({
            scopes: GRAPH_SCOPES,
            account: currentAccount,
        });
        accessToken = response.accessToken;
        return accessToken;
    } catch (err) {
        if (err instanceof msal.InteractionRequiredAuthError) {
            await msalInstance.acquireTokenRedirect({ scopes: GRAPH_SCOPES });
        }
        return '';
    }
}

// ── Auth actions ──

async function signIn(): Promise<void> {
    if (!msalInstance) return;
    try {
        const response = await msalInstance.loginPopup({
            scopes: GRAPH_SCOPES,
        });
        currentAccount = response.account;
        accessToken = response.accessToken;
        setupUI();
    } catch (err) {
        console.error('Login failed:', err);
    }
}

function signOut(): void {
    if (!msalInstance) return;
    msalInstance.logoutPopup();
    currentAccount = null;
    accessToken = '';
    setupUI();
}

// ── UI Setup ──

function setupUI(): void {
    const loginSection = document.getElementById('login-section')!;
    const appSection = document.getElementById('app-section')!;
    const detailSection = document.getElementById('detail-section')!;
    const userName = document.getElementById('user-name')!;
    const btnLogin = document.getElementById('btn-login')!;
    const btnLogout = document.getElementById('btn-logout')!;

    if (currentAccount) {
        loginSection.style.display = 'none';
        appSection.style.display = 'block';
        detailSection.style.display = 'none';
        userName.textContent = currentAccount.name || currentAccount.username;
        btnLogin.style.display = 'none';
        btnLogout.style.display = 'inline-block';
        loadSubscriptions();
        loadNotifications();
    } else {
        loginSection.style.display = 'block';
        appSection.style.display = 'none';
        detailSection.style.display = 'none';
        userName.textContent = '';
        btnLogin.style.display = 'inline-block';
        btnLogout.style.display = 'none';
    }
}

// ── Data loading ──

function getUserId(): string {
    return currentAccount?.localAccountId || currentAccount?.homeAccountId || '';
}

async function loadSubscriptions(): Promise<void> {
    const container = document.getElementById('subscriptions-container')!;
    container.innerHTML = '<div class="loading">Loading…</div>';

    try {
        const res = await fetch(`/api/subscriptions?userId=${encodeURIComponent(getUserId())}`);
        const subs: SubscriptionRecord[] = await res.json();

        if (subs.length === 0) {
            container.innerHTML =
                '<div class="empty-state">No subscriptions yet. Create one above.</div>';
            return;
        }

        const rows = subs
            .map((s) => {
                const expiry = new Date(s.expirationDateTime).toLocaleString();
                const lastNotif = s.lastNotificationAt
                    ? new Date(s.lastNotificationAt).toLocaleString()
                    : '—';
                return `
          <tr>
            <td title="${s.rowKey}">${s.rowKey.substring(0, 12)}…</td>
            <td>${escapeHtml(s.resource)}</td>
            <td>${escapeHtml(s.changeType)}</td>
            <td>${expiry}</td>
            <td>${lastNotif}</td>
            <td>
              <button class="btn-danger btn-small" data-delete-sub="${s.rowKey}">Delete</button>
            </td>
          </tr>`;
            })
            .join('');

        container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Subscription ID</th>
            <th>Resource</th>
            <th>Change Type</th>
            <th>Expires</th>
            <th>Last Notification</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

        // Attach delete handlers
        container.querySelectorAll('[data-delete-sub]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const subId = (btn as HTMLElement).dataset.deleteSub!;
                if (confirm('Delete this subscription record?')) {
                    await fetch(
                        `/api/subscriptions/${encodeURIComponent(subId)}?userId=${encodeURIComponent(getUserId())}`,
                        { method: 'DELETE' },
                    );
                    loadSubscriptions();
                }
            });
        });
    } catch (err) {
        container.innerHTML = `<div class="empty-state" style="color:var(--danger)">Error loading subscriptions.</div>`;
        console.error(err);
    }
}

async function loadNotifications(): Promise<void> {
    const container = document.getElementById('notifications-container')!;
    container.innerHTML = '<div class="loading">Loading…</div>';

    try {
        const res = await fetch(`/api/notifications?userId=${encodeURIComponent(getUserId())}`);
        const notifs: NotificationRecord[] = await res.json();

        if (notifs.length === 0) {
            container.innerHTML = '<div class="empty-state">No notifications received yet.</div>';
            return;
        }

        // Sort newest first
        notifs.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

        const rows = notifs
            .map((n) => {
                const received = new Date(n.receivedAt).toLocaleString();
                return `
          <tr>
            <td>${received}</td>
            <td title="${n.subscriptionId}">${n.subscriptionId.substring(0, 12)}…</td>
            <td>
              <a href="#" class="detail-link" data-notif-id="${n.rowKey}" style="color:var(--primary);font-weight:600;text-decoration:none">
                View Details
              </a>
            </td>
          </tr>`;
            })
            .join('');

        container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Received At</th>
            <th>Subscription ID</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

        // Attach detail handlers
        container.querySelectorAll('.detail-link').forEach((link) => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const notifId = (link as HTMLElement).dataset.notifId!;
                showNotificationDetail(notifId);
            });
        });
    } catch (err) {
        container.innerHTML = `<div class="empty-state" style="color:var(--danger)">Error loading notifications.</div>`;
        console.error(err);
    }
}

async function showNotificationDetail(notificationId: string): Promise<void> {
    const appSection = document.getElementById('app-section')!;
    const detailSection = document.getElementById('detail-section')!;
    const detailMeta = document.getElementById('detail-meta')!;
    const detailBody = document.getElementById('detail-body')!;

    appSection.style.display = 'none';
    detailSection.style.display = 'block';
    detailBody.textContent = 'Loading…';
    detailMeta.innerHTML = '';

    try {
        const res = await fetch(
            `/api/notifications/${encodeURIComponent(notificationId)}?userId=${encodeURIComponent(getUserId())}`,
        );
        const notif: NotificationRecord = await res.json();

        detailMeta.innerHTML = `
      <dt>Notification ID</dt><dd>${escapeHtml(notif.rowKey)}</dd>
      <dt>Subscription ID</dt><dd>${escapeHtml(notif.subscriptionId)}</dd>
      <dt>Received At</dt><dd>${new Date(notif.receivedAt).toLocaleString()}</dd>
    `;

        // Pretty-print the JSON body
        try {
            const parsed = JSON.parse(notif.body);
            detailBody.textContent = JSON.stringify(parsed, null, 2);
        } catch {
            detailBody.textContent = notif.body;
        }
    } catch (err) {
        detailBody.textContent = 'Error loading notification details.';
        console.error(err);
    }
}

// ── Create Subscription ──

async function createSubscription(
    resource: string,
    changeType: string,
    expirationMinutes: number,
): Promise<void> {
    if (!accessToken) {
        await acquireTokenSilent();
        if (!accessToken) {
            alert('Could not acquire access token. Please sign in again.');
            return;
        }
    }

    const expirationDateTime = new Date(Date.now() + expirationMinutes * 60 * 1000).toISOString();

    const notificationUrl = appConfig?.graphNotificationUrl || '';
    if (!notificationUrl) {
        alert(
            'GRAPH_NOTIFICATION_URL is not configured on the server. Set it in your .env file to the public URL of your /api/webhook endpoint.',
        );
        return;
    }

    // Call Microsoft Graph to create the subscription
    const graphPayload = {
        changeType,
        notificationUrl,
        resource,
        expirationDateTime,
    };

    try {
        const graphRes = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(graphPayload),
        });

        if (!graphRes.ok) {
            const errBody = await graphRes.text();
            alert(`Graph API error (${graphRes.status}): ${errBody}`);
            return;
        }

        const graphSub = await graphRes.json();

        // Store in our backend database
        await fetch('/api/subscriptions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: getUserId(),
                subscriptionId: graphSub.id,
                resource: graphSub.resource,
                changeType: graphSub.changeType,
                expirationDateTime: graphSub.expirationDateTime,
                notificationUrl: graphSub.notificationUrl,
            }),
        });

        loadSubscriptions();
    } catch (err) {
        console.error('Failed to create subscription:', err);
        alert('Failed to create subscription. Check the console for details.');
    }
}

// ── Helpers ──

function escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── Event Wiring ──

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-login')!.addEventListener('click', signIn);
    document.getElementById('btn-login-main')!.addEventListener('click', signIn);
    document.getElementById('btn-logout')!.addEventListener('click', signOut);
    document.getElementById('btn-refresh-subs')!.addEventListener('click', loadSubscriptions);
    document.getElementById('btn-refresh-notifs')!.addEventListener('click', loadNotifications);

    document.getElementById('back-to-main')!.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('detail-section')!.style.display = 'none';
        document.getElementById('app-section')!.style.display = 'block';
    });

    document.getElementById('create-subscription-form')!.addEventListener('submit', (e) => {
        e.preventDefault();
        const resource = (document.getElementById('sub-resource') as HTMLInputElement).value.trim();
        const changeType = (document.getElementById('sub-changeType') as HTMLSelectElement).value;
        const expMinutes =
            parseInt((document.getElementById('sub-expiration') as HTMLInputElement).value, 10) ||
            60;
        createSubscription(resource, changeType, expMinutes);
    });

    init();
});
