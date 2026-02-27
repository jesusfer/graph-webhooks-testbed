// -- Subscriptions Table --
// Handles loading and displaying the subscriptions table

import { apiFetch } from '../api';
import { graphFetch } from '../graph';
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
    removedAt?: string;
    needsReauthorization?: boolean;
}

interface SubscriptionsTableDeps {
    getUserId: () => string;
}

let deps: SubscriptionsTableDeps;

export function initSubscriptionsTable(dependencies: SubscriptionsTableDeps): void {
    deps = dependencies;
}

export async function loadSubscriptions(): Promise<void> {
    const container = document.getElementById('subscriptions-container')!;
    const reloadSpinner = document.getElementById('subs-reload-spinner');
    const isReload = !!container.querySelector('table');

    // Only show the loading placeholder on first load (no table yet)
    if (!isReload) {
        container.innerHTML = '<div class="loading">Loading...</div>';
    } else if (reloadSpinner) {
        reloadSpinner.hidden = false;
    }

    const btnRefresh = document.getElementById('btn-refresh-subs') as HTMLButtonElement | null;
    if (btnRefresh) btnRefresh.disabled = true;

    try {
        const res = await apiFetch(
            `/api/subscriptions?userId=${encodeURIComponent(deps.getUserId())}`,
        );
        const subs: SubscriptionRecord[] = await res.json();

        if (subs.length === 0) {
            container.innerHTML =
                '<div class="empty-state">No subscriptions yet. Create one above.</div>';
            return;
        }

        // Filter based on the "Show expired" toggle
        const showExpiredChk = document.getElementById(
            'chk-show-expired-subs',
        ) as HTMLInputElement | null;
        const showExpired = showExpiredChk ? showExpiredChk.checked : true;
        const filteredSubs = showExpired
            ? subs
            : subs.filter((s) => {
                  const isExpired = new Date(s.expirationDateTime).getTime() < Date.now();
                  const isRemoved = !!s.removedAt;
                  return !isExpired && !isRemoved;
              });

        // Count expired/removed subscriptions for the toggle label
        const expiredCount = subs.filter((s) => {
            const isExpired = new Date(s.expirationDateTime).getTime() < Date.now();
            return isExpired || !!s.removedAt;
        }).length;
        const expiredLabel = document.getElementById('expired-subs-count');
        if (expiredLabel) {
            expiredLabel.textContent = `(${expiredCount})`;
        }

        if (filteredSubs.length === 0) {
            const hiddenCount = subs.length;
            container.innerHTML = `<div class="empty-state">No active subscriptions. ${hiddenCount} expired subscription(s) hidden.</div>`;
            return;
        }

        // Sort: active subscriptions first (by remaining time ascending),
        // then expired/removed subscriptions (by expiry date ascending)
        filteredSubs.sort((a, b) => {
            const now = Date.now();
            const aExpiry = new Date(a.expirationDateTime).getTime();
            const bExpiry = new Date(b.expirationDateTime).getTime();
            const aIsExpired = aExpiry < now || !!a.removedAt;
            const bIsExpired = bExpiry < now || !!b.removedAt;

            if (aIsExpired !== bIsExpired) {
                return aIsExpired ? 1 : -1; // active first
            }
            if (!aIsExpired) {
                // Both active: sort by remaining time ascending (closest to expire first)
                return aExpiry - bExpiry;
            }
            // Both expired: sort by expiry date descending
            return bExpiry - aExpiry;
        });

        const rows = filteredSubs
            .map((s) => {
                const expiryDate = new Date(s.expirationDateTime);
                const expiry = formatDateTime(expiryDate);
                const isExpired = expiryDate.getTime() < Date.now();
                const isRemoved = !!s.removedAt;
                const remainingLabel = isRemoved
                    ? '<strong style="color:var(--danger)">(removed)</strong>'
                    : isExpired
                      ? '<strong style="color:var(--danger)">(expired)</strong>'
                      : `<span style="opacity:0.7">(${formatTimeRemaining(expiryDate)})</span>`;
                const lastNotif = s.lastNotificationAt
                    ? formatDateTime(new Date(s.lastNotificationAt))
                    : '—';
                const renewBtn =
                    isExpired || isRemoved
                        ? ` <button class="btn-primary btn-small" data-renew-sub="${s.rowKey}" data-renew-resource="${escapeAttr(s.resource)}" data-renew-changetype="${escapeAttr(s.changeType)}" data-renew-includeresourcedata="${s.includeResourceData ? 'true' : 'false'}">Renew</button>`
                        : '';
                const reauthorizeBtn =
                    s.needsReauthorization && !isExpired && !isRemoved
                        ? ` <button class="btn-warning btn-small" data-reauth-sub="${s.rowKey}">Reauthorize</button>`
                        : '';
                return `
          <tr data-sub-row="${s.rowKey}">
            <td title="${s.rowKey}">${escapeHtml(s.resource)}</td>
            <td>${formatChangeTypeTags(s.changeType)}</td>
            <td style="text-align:center" title="${s.includeResourceData ? 'Include resource data enabled' : 'Include resource data disabled'}">${s.includeResourceData ? '🔒' : ''}</td>
            <td style="white-space:nowrap">${expiry}<br/>${remainingLabel}</td>
            <td style="white-space:nowrap">${lastNotif}</td>
            <td class="actions">
              <button class="btn-danger btn-small" data-delete-sub="${s.rowKey}" data-delete-expires="${s.expirationDateTime}">Delete</button>${reauthorizeBtn}${renewBtn}
            </td>
          </tr>`;
            })
            .join('');

        container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Resource</th>
            <th>Change Type</th>
            <th style="text-align:center">Resource Data</th>
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
                    // Try to delete the subscription from Graph (skip if already expired)
                    if (!isExpired) {
                        try {
                            const graphRes = await graphFetch(
                                `/v1.0/subscriptions/${encodeURIComponent(subId)}`,
                                { method: 'DELETE' },
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
                    // Remove the local record (also deletes its notifications on the backend)
                    await apiFetch(
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
                const includeResourceData = el.dataset.renewIncluderesourcedata === 'true';
                // Keep the old expired subscription record and create a new subscription with the same options
                await createSubscription(resource, changeType, 60, includeResourceData);
            });
        });

        // Attach reauthorize handlers
        container.querySelectorAll('[data-reauth-sub]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const el = btn as HTMLElement;
                const subId = el.dataset.reauthSub!;
                el.textContent = 'Reauthorizing...';
                (el as HTMLButtonElement).disabled = true;
                try {
                    const newExpiration = new Date(Date.now() + 60 * 60 * 1000).toISOString();
                    const graphRes = await graphFetch(
                        `/v1.0/subscriptions/${encodeURIComponent(subId)}`,
                        {
                            method: 'PATCH',
                            body: JSON.stringify({ expirationDateTime: newExpiration }),
                        },
                    );
                    if (!graphRes.ok) {
                        const errBody = await graphRes.text();
                        console.error(`Failed to reauthorize (${graphRes.status}): ${errBody}`);
                        alert(`Failed to reauthorize subscription: ${graphRes.status}`);
                        return;
                    }
                    const graphBody = await graphRes.json();
                    // Clear the needsReauthorization flag and update expiration on the backend
                    await apiFetch(
                        `/api/subscriptions/${encodeURIComponent(subId)}/reauthorize?userId=${encodeURIComponent(deps.getUserId())}`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                expirationDateTime: graphBody.expirationDateTime,
                            }),
                        },
                    );
                    loadSubscriptions();
                } catch (err) {
                    console.error('Error reauthorizing subscription:', err);
                    alert('Error reauthorizing subscription. See console for details.');
                } finally {
                    el.textContent = 'Reauthorize';
                    (el as HTMLButtonElement).disabled = false;
                }
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
    } finally {
        if (reloadSpinner) reloadSpinner.hidden = true;
        const btnRefresh = document.getElementById('btn-refresh-subs') as HTMLButtonElement | null;
        if (btnRefresh) btnRefresh.disabled = false;
    }
}

// -- Helpers --

function escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatDateTime(date: Date): string {
    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
}

const changeTypeColors: Record<string, string> = {
    created: '#107c10',
    updated: '#0078d4',
    deleted: '#d13438',
};
const changeTypeDefaultColor = '#8764b8';

function formatChangeTypeTags(changeType: string): string {
    return changeType
        .split(',')
        .map((ct) => ct.trim())
        .filter(Boolean)
        .map((ct) => {
            const color = changeTypeColors[ct.toLowerCase()] ?? changeTypeDefaultColor;
            return `<span class="change-type-tag" style="background:${color}">${escapeHtml(ct)}</span>`;
        })
        .join(' ');
}

function formatTimeRemaining(expiryDate: Date): string {
    const diffMs = expiryDate.getTime() - Date.now();
    if (diffMs <= 0) return 'expired';

    const totalSeconds = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

    return parts.join(' ') + ' remaining';
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

export function setupSubscriptionsTableEventHandlers(onManualRefresh?: () => void): void {
    document.getElementById('btn-refresh-subs')!.addEventListener('click', () => {
        loadSubscriptions();
        onManualRefresh?.();
    });
    document.getElementById('chk-show-expired-subs')!.addEventListener('change', () => {
        loadSubscriptions();
    });
}
