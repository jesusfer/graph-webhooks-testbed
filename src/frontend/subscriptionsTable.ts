// -- Subscriptions Table --
// Handles loading and displaying the subscriptions table

import { createSubscription } from './createSubscription';

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

interface SubscriptionsTableDeps {
    getUserId: () => string;
    getAccessToken: () => string;
    acquireTokenSilent: () => Promise<string>;
}

let deps: SubscriptionsTableDeps;

export function initSubscriptionsTable(dependencies: SubscriptionsTableDeps): void {
    deps = dependencies;
}

export async function loadSubscriptions(): Promise<void> {
    const container = document.getElementById('subscriptions-container')!;
    container.innerHTML = '<div class="loading">Loading...</div>';

    try {
        const res = await fetch(
            `/api/subscriptions?userId=${encodeURIComponent(deps.getUserId())}`,
        );
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
                            const accessToken = await deps.acquireTokenSilent();
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
                        `/api/subscriptions/${encodeURIComponent(subId)}?userId=${encodeURIComponent(deps.getUserId())}`,
                        { method: 'DELETE' },
                    );
                    removeHighlightsForSubscription(subId);
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
                    `/api/subscriptions/${encodeURIComponent(oldSubId)}?userId=${encodeURIComponent(deps.getUserId())}`,
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

// -- Helpers --

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

export function highlightNotificationsForSubscription(subscriptionId: string): void {
    const notifsContainer = document.getElementById('notifications-container')!;
    const subsContainer = document.getElementById('subscriptions-container')!;
    const notifRows = notifsContainer.querySelectorAll('tr[data-sub-id]');
    const subRows = subsContainer.querySelectorAll('tr[data-sub-row]');
    let anyHighlighted = false;

    notifRows.forEach((row) => {
        const rowSubId = (row as HTMLElement).dataset.subId;
        if (rowSubId === subscriptionId) {
            row.classList.toggle('highlight');
            if (row.classList.contains('highlight')) anyHighlighted = true;
        } else {
            row.classList.remove('highlight');
        }
    });

    subRows.forEach((row) => {
        const rowSubId = (row as HTMLElement).dataset.subRow;
        if (rowSubId === subscriptionId) {
            row.classList.toggle('highlight', anyHighlighted);
        } else {
            row.classList.remove('highlight');
        }
    });

    // Scroll to the notifications section if we highlighted something
    if (anyHighlighted) {
        notifsContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function removeHighlightsForSubscription(subscriptionId: string): void {
    const container = document.getElementById('notifications-container')!;
    container.querySelectorAll(`tr[data-sub-id="${subscriptionId}"]`).forEach((row) => {
        row.classList.remove('highlight');
    });
}

export function setupSubscriptionsTableEventHandlers(): void {
    document.getElementById('btn-refresh-subs')!.addEventListener('click', loadSubscriptions);
}
