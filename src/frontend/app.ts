import * as msal from '@azure/msal-browser';

// ── Types ──

interface AppConfig {
    clientId: string;
    tenantId: string;
    redirectUri: string;
    graphNotificationUrl: string;
    hasEncryptionCertificate: boolean;
    encryptionCertificate: string;
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
    includeResourceData?: boolean;
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

const DEFAULT_SCOPES = ['User.Read'];
const EXTRA_SCOPES_KEY = 'graph-webhooks-extra-scopes';

function getExtraScopes(): string[] {
    const stored = localStorage.getItem(EXTRA_SCOPES_KEY);
    if (!stored) return [];
    return stored
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

function saveExtraScopes(scopes: string[]): void {
    localStorage.setItem(EXTRA_SCOPES_KEY, scopes.join(','));
}

function getAllScopes(): string[] {
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

let ws: WebSocket | null = null;

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
    connectWebSocket();
}

async function acquireTokenSilent(): Promise<string> {
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

// ── Auth actions ──

async function signIn(): Promise<void> {
    if (!msalInstance) return;
    try {
        const response = await msalInstance.loginPopup({
            scopes: getAllScopes(),
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
        btnLogin.hidden = true;
        btnLogout.hidden = false;
        document.getElementById('btn-consent-scopes')!.hidden = false;
        loadSubscriptions();
        loadNotifications();
    } else {
        loginSection.style.display = 'block';
        appSection.style.display = 'none';
        detailSection.style.display = 'none';
        userName.textContent = '';
        btnLogin.hidden = false;
        btnLogout.hidden = true;
        document.getElementById('btn-consent-scopes')!.hidden = true;
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
                const expiryDate = new Date(s.expirationDateTime);
                const expiry = expiryDate.toLocaleString();
                const isExpired = expiryDate.getTime() < Date.now();
                const lastNotif = s.lastNotificationAt
                    ? new Date(s.lastNotificationAt).toLocaleString()
                    : '—';
                const renewBtn = isExpired
                    ? ` <button class="btn-primary btn-small" data-renew-sub="${s.rowKey}" data-renew-resource="${escapeAttr(s.resource)}" data-renew-changetype="${escapeAttr(s.changeType)}" data-renew-includeresourcedata="${s.includeResourceData ? 'true' : 'false'}">Renew</button>`
                    : '';
                return `
          <tr data-sub-row="${s.rowKey}">
            <td title="${s.rowKey}">${s.rowKey}</td>
            <td>${escapeHtml(s.resource)}</td>
            <td>${escapeHtml(s.changeType)}</td>
            <td>${expiry}${isExpired ? ' <strong style="color:var(--danger)">(expired)</strong>' : ''}</td>
            <td>${lastNotif}</td>
            <td class="actions">
              <button class="btn-danger btn-small" data-delete-sub="${s.rowKey}" data-delete-expires="${s.expirationDateTime}">Delete</button>${renewBtn}
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
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const el = btn as HTMLElement;
                const subId = el.dataset.deleteSub!;
                const expires = el.dataset.deleteExpires!;
                const isExpired = new Date(expires).getTime() < Date.now();
                if (confirm('Delete this subscription record?')) {
                    // If the subscription hasn't expired, try to delete it from Graph first
                    if (!isExpired) {
                        try {
                            await acquireTokenSilent();
                            const graphRes = await fetch(
                                `https://graph.microsoft.com/v1.0/subscriptions/${encodeURIComponent(subId)}`,
                                {
                                    method: 'DELETE',
                                    headers: { Authorization: `Bearer ${accessToken}` },
                                },
                            );
                            if (!graphRes.ok && graphRes.status !== 404) {
                                const errBody = await graphRes.text();
                                console.warn(
                                    `Graph delete returned ${graphRes.status}: ${errBody}`,
                                );
                            }
                        } catch (graphErr) {
                            console.warn('Failed to delete subscription from Graph:', graphErr);
                        }
                    }
                    // Always remove the local record
                    await fetch(
                        `/api/subscriptions/${encodeURIComponent(subId)}?userId=${encodeURIComponent(getUserId())}`,
                        { method: 'DELETE' },
                    );
                    loadSubscriptions();
                }
            });
        });

        // Attach renew handlers
        container.querySelectorAll('[data-renew-sub]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const el = btn as HTMLElement;
                const resource = el.dataset.renewResource!;
                const changeType = el.dataset.renewChangetype!;
                const oldSubId = el.dataset.renewSub!;
                const includeResourceData = el.dataset.renewIncluderesourcedata === 'true';
                // Delete the old record, then create a new subscription with the same options
                await fetch(
                    `/api/subscriptions/${encodeURIComponent(oldSubId)}?userId=${encodeURIComponent(getUserId())}`,
                    { method: 'DELETE' },
                );
                await createSubscription(resource, changeType, 60, includeResourceData);
            });
        });

        // Attach subscription row click → highlight matching notifications
        container.querySelectorAll('[data-sub-row]').forEach((row) => {
            row.addEventListener('click', () => {
                const subId = (row as HTMLElement).dataset.subRow!;
                highlightNotificationsForSubscription(subId);
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
          <tr data-sub-id="${n.subscriptionId}">
            <td>${received}</td>
            <td title="${n.subscriptionId}">${n.subscriptionId}</td>
            <td class="actions">
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
    includeResourceData: boolean = false,
): Promise<void> {
    hideCreateResult();
    setCreateFormBusy(true);

    try {
        await _doCreateSubscription(resource, changeType, expirationMinutes, includeResourceData);
    } finally {
        setCreateFormBusy(false);
    }
}

async function _doCreateSubscription(
    resource: string,
    changeType: string,
    expirationMinutes: number,
    includeResourceData: boolean,
): Promise<void> {
    if (!accessToken) {
        await acquireTokenSilent();
        if (!accessToken) {
            showCreateResult('Could not acquire access token. Please sign in again.', false);
            return;
        }
    }

    const expirationDateTime = new Date(Date.now() + expirationMinutes * 60 * 1000).toISOString();

    const notificationUrl = appConfig?.graphNotificationUrl || '';
    if (!notificationUrl) {
        showCreateResult(
            'GRAPH_NOTIFICATION_URL is not configured on the server. Set it in your .env file to the public URL of your /api/webhook endpoint.',
            false,
        );
        return;
    }

    // Call Microsoft Graph to create the subscription
    const graphPayload: Record<string, unknown> = {
        changeType,
        notificationUrl,
        resource,
        expirationDateTime,
    };

    if (includeResourceData) {
        if (!appConfig?.hasEncryptionCertificate) {
            showCreateResult(
                'GRAPH_ENCRYPTION_CERTIFICATE is not configured on the server. Set it in your .env file to enable rich notifications with resource data.',
                false,
            );
            return;
        }
        graphPayload.includeResourceData = true;
        graphPayload.encryptionCertificate = appConfig.encryptionCertificate;
        graphPayload.encryptionCertificateId = 'graphWebhooksTestbed';
    }

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
            showCreateResult(`Graph API error (${graphRes.status}): ${errBody}`, false);
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
                ...(includeResourceData ? { includeResourceData: true } : {}),
            }),
        });

        showCreateResult(
            `Subscription created successfully (ID: ${graphSub.id}, expires: ${new Date(graphSub.expirationDateTime).toLocaleString()})`,
            true,
        );
        loadSubscriptions();
    } catch (err) {
        console.error('Failed to create subscription:', err);
        showCreateResult(
            `Failed to create subscription: ${err instanceof Error ? err.message : String(err)}`,
            false,
        );
    }
}

// ── Create-form busy state ──

function setCreateFormBusy(busy: boolean): void {
    const fieldset = document.getElementById('create-sub-fieldset') as HTMLFieldSetElement | null;
    const spinner = document.querySelector('#btn-create-sub .spinner') as HTMLElement | null;
    const btnText = document.getElementById('btn-create-sub-text');
    if (fieldset) fieldset.disabled = busy;
    if (spinner) spinner.hidden = !busy;
    if (btnText) btnText.textContent = busy ? 'Creating…' : 'Create Subscription';
}

// ── Create-result feedback box ──

function showCreateResult(message: string, success: boolean): void {
    const box = document.getElementById('create-result')!;
    box.textContent = message;
    box.className = `create-result ${success ? 'success' : 'error'}`;
    box.hidden = false;
}

function hideCreateResult(): void {
    const box = document.getElementById('create-result');
    if (box) {
        box.hidden = true;
        box.textContent = '';
        box.className = 'create-result';
    }
}

// ── Helpers ──

function escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeAttr(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function highlightNotificationsForSubscription(subscriptionId: string): void {
    const container = document.getElementById('notifications-container')!;
    const rows = container.querySelectorAll('tr[data-sub-id]');
    let anyHighlighted = false;

    rows.forEach((row) => {
        const rowSubId = (row as HTMLElement).dataset.subId;
        if (rowSubId === subscriptionId) {
            row.classList.toggle('highlight');
            if (row.classList.contains('highlight')) anyHighlighted = true;
        } else {
            row.classList.remove('highlight');
        }
    });

    // Scroll to the notifications section if we highlighted something
    if (anyHighlighted) {
        container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

async function clearAllNotifications(): Promise<void> {
    if (!confirm('Are you sure you want to delete all notifications?')) return;

    try {
        await fetch(`/api/notifications?userId=${encodeURIComponent(getUserId())}`, {
            method: 'DELETE',
        });
        loadNotifications();
    } catch (err) {
        console.error('Failed to clear notifications:', err);
        alert('Failed to clear notifications. Check the console for details.');
    }
}

// ── WebSocket ──

function connectWebSocket(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.addEventListener('open', () => {
        console.log('WebSocket connected');
    });

    ws.addEventListener('message', (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'new-notification') {
                // Only refresh if the notification belongs to the current user
                if (msg.payload?.userId === getUserId()) {
                    loadNotifications();
                    loadSubscriptions(); // also refresh to update lastNotificationAt
                }
            }
        } catch {
            // ignore malformed messages
        }
    });

    ws.addEventListener('close', () => {
        console.log('WebSocket disconnected, reconnecting in 5s…');
        setTimeout(connectWebSocket, 5000);
    });

    ws.addEventListener('error', () => {
        ws?.close();
    });
}

// ── Event Wiring ──

document.addEventListener('DOMContentLoaded', () => {
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
    document.getElementById('btn-refresh-subs')!.addEventListener('click', loadSubscriptions);
    document.getElementById('btn-refresh-notifs')!.addEventListener('click', loadNotifications);
    document.getElementById('btn-clear-notifs')!.addEventListener('click', clearAllNotifications);

    (document.getElementById('chk-line-wrap') as HTMLInputElement).addEventListener(
        'change',
        (e) => {
            const pre = document.getElementById('detail-body')!;
            if ((e.target as HTMLInputElement).checked) {
                pre.classList.add('line-wrap');
            } else {
                pre.classList.remove('line-wrap');
            }
        },
    );

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
        const includeResourceData = (
            document.getElementById('sub-includeResourceData') as HTMLInputElement
        ).checked;
        createSubscription(resource, changeType, expMinutes, includeResourceData);
    });

    init();
});
