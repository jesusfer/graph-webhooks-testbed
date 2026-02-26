// -- App Subscriptions Table --
// Handles loading and displaying the app-only subscriptions table

import { apiFetch } from '../apiFetch';

interface AppSubscriptionRecord {
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
}

export async function loadAppSubscriptions(): Promise<void> {
    const container = document.getElementById('app-subscriptions-container')!;
    const reloadSpinner = document.getElementById('app-subs-reload-spinner');
    const isReload = !!container.querySelector('table');

    if (!isReload) {
        container.innerHTML = '<div class="loading">Loading...</div>';
    } else if (reloadSpinner) {
        reloadSpinner.hidden = false;
    }

    const btnRefresh = document.getElementById('btn-refresh-app-subs') as HTMLButtonElement | null;
    if (btnRefresh) btnRefresh.disabled = true;

    try {
        const res = await apiFetch('/api/app-subscriptions');
        const subs: AppSubscriptionRecord[] = await res.json();

        if (subs.length === 0) {
            container.innerHTML =
                '<div class="empty-state">No app subscriptions yet. Create one above.</div>';
            return;
        }

        // Filter based on the "Show expired" toggle
        const showExpiredChk = document.getElementById(
            'chk-show-expired-app-subs',
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
        const expiredLabel = document.getElementById('expired-app-subs-count');
        if (expiredLabel) {
            expiredLabel.textContent = `(${expiredCount})`;
        }

        if (filteredSubs.length === 0) {
            const hiddenCount = subs.length;
            container.innerHTML = `<div class="empty-state">No active app subscriptions. ${hiddenCount} expired subscription(s) hidden.</div>`;
            return;
        }

        // Sort: active first (closest to expire), then expired (most recent first)
        filteredSubs.sort((a, b) => {
            const now = Date.now();
            const aExpiry = new Date(a.expirationDateTime).getTime();
            const bExpiry = new Date(b.expirationDateTime).getTime();
            const aIsExpired = aExpiry < now || !!a.removedAt;
            const bIsExpired = bExpiry < now || !!b.removedAt;

            if (aIsExpired !== bIsExpired) {
                return aIsExpired ? 1 : -1;
            }
            if (!aIsExpired) {
                return aExpiry - bExpiry;
            }
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
                        ? ''
                        : ` <button class="btn-primary btn-small" data-app-renew-sub="${s.rowKey}">Renew</button>`;

                return `
          <tr>
            <td title="${s.rowKey}">${escapeHtml(s.resource)}</td>
            <td>${formatChangeTypeTags(s.changeType)}</td>
            <td style="text-align:center" title="${s.includeResourceData ? 'Include resource data enabled' : 'Include resource data disabled'}">${s.includeResourceData ? '🔒' : ''}</td>
            <td style="white-space:nowrap">${expiry}<br/>${remainingLabel}</td>
            <td style="white-space:nowrap">${lastNotif}</td>
            <td class="actions">
              <button class="btn-danger btn-small" data-app-delete-sub="${s.rowKey}" data-app-delete-expires="${s.expirationDateTime}">Delete</button>${renewBtn}
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
        container.querySelectorAll('[data-app-delete-sub]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const el = btn as HTMLElement;
                const subId = el.dataset.appDeleteSub!;
                if (confirm('Delete this app subscription?')) {
                    await apiFetch(`/api/app-subscriptions/${encodeURIComponent(subId)}`, {
                        method: 'DELETE',
                    });
                    loadAppSubscriptions();
                }
            });
        });

        // Attach renew handlers
        container.querySelectorAll('[data-app-renew-sub]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const el = btn as HTMLButtonElement;
                const subId = el.dataset.appRenewSub!;
                el.textContent = 'Renewing...';
                el.disabled = true;
                try {
                    const res = await apiFetch(
                        `/api/app-subscriptions/${encodeURIComponent(subId)}/renew`,
                        {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ expirationMinutes: 60 }),
                        },
                    );
                    if (!res.ok) {
                        const errBody = await res.text();
                        console.error(`Failed to renew (${res.status}): ${errBody}`);
                        alert(`Failed to renew subscription: ${res.status}`);
                        return;
                    }
                    loadAppSubscriptions();
                } catch (err) {
                    console.error('Error renewing app subscription:', err);
                    alert('Error renewing subscription. See console for details.');
                } finally {
                    el.textContent = 'Renew';
                    el.disabled = false;
                }
            });
        });
    } catch (err) {
        container.innerHTML = `<div class="empty-state" style="color:var(--danger)">Error loading app subscriptions.</div>`;
        console.error(err);
    } finally {
        if (reloadSpinner) reloadSpinner.hidden = true;
        if (btnRefresh) btnRefresh.disabled = false;
    }
}

export function setupAppSubscriptionsTableEventHandlers(
    onManualRefresh?: () => void,
): void {
    document.getElementById('btn-refresh-app-subs')!.addEventListener('click', () => {
        loadAppSubscriptions();
        onManualRefresh?.();
    });
    document.getElementById('chk-show-expired-app-subs')!.addEventListener('change', () => {
        loadAppSubscriptions();
    });
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
