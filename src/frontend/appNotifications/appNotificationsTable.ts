// -- App Notifications Table --
// Handles loading and displaying notifications for app-only subscriptions

import { showNotificationDetail } from '../detailsPage';
import { NotificationRecord } from '../types';
import { apiFetch } from '../api';

const APP_USER_ID = '__app__';

export async function loadAppNotifications(): Promise<void> {
    const container = document.getElementById('app-notifications-container')!;
    const reloadSpinner = document.getElementById('app-notifs-reload-spinner');
    const isReload = !!container.querySelector('table');

    if (!isReload) {
        container.innerHTML = '<div class="loading">Loading...</div>';
    } else if (reloadSpinner) {
        reloadSpinner.hidden = false;
    }

    const btnRefresh = document.getElementById(
        'btn-refresh-app-notifs',
    ) as HTMLButtonElement | null;
    const btnClear = document.getElementById('btn-clear-app-notifs') as HTMLButtonElement | null;
    if (btnRefresh) btnRefresh.disabled = true;
    if (btnClear) btnClear.disabled = true;

    try {
        const [notifsRes, subsRes] = await Promise.all([
            apiFetch('/api/app-subscriptions/notifications'),
            apiFetch('/api/app-subscriptions'),
        ]);
        const notifs: NotificationRecord[] = await notifsRes.json();
        const subs: { rowKey: string; resource: string }[] = await subsRes.json();
        const subResourceMap = new Map(subs.map((s) => [s.rowKey, s.resource]));

        if (notifs.length === 0) {
            container.innerHTML = '<div class="empty-state">No notifications received yet.</div>';
            return;
        }

        // Sort newest first
        notifs.sort(
            (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
        );

        const lifecycleCount = notifs.filter((n) => n.lifecycleEvent).length;
        const lifecycleChk = document.getElementById('chk-show-lifecycle-app-notifs') as HTMLInputElement | null;
        const lifecycleCountEl = document.getElementById('lifecycle-app-notifs-count');
        if (lifecycleCountEl) {
            lifecycleCountEl.textContent = lifecycleCount > 0 ? `(${lifecycleCount})` : '';
        }
        const showLifecycle = lifecycleChk?.checked ?? false;

        const rows = notifs
            .map((n) => {
                const received = new Date(n.receivedAt).toLocaleString(undefined, {
                    hour12: false,
                });
                const resource = subResourceMap.get(n.subscriptionId) ?? n.subscriptionId;
                const validityIcon =
                    n.clientStateValid === true
                        ? '<span title="clientState valid" style="color:var(--success);font-size:1.1rem">&#x2705;</span>'
                        : n.clientStateValid === false
                          ? '<span title="clientState mismatch" style="color:var(--danger);font-size:1.1rem">&#x274C;</span>'
                          : '<span title="clientState not checked" style="color:var(--text-secondary);font-size:1.1rem">&#x2014;</span>';
                const tokenValidityIcon =
                    n.validationTokensValid === true
                        ? `<span title="${escapeHtml(n.validationTokensSummary ?? 'Tokens valid')}" style="color:var(--success);font-size:1.1rem">&#x2705;</span>`
                        : n.validationTokensValid === false
                          ? `<span title="${escapeHtml(n.validationTokensSummary ?? 'Token validation failed')}" style="color:var(--danger);font-size:1.1rem">&#x274C;</span>`
                          : '<span title="No validation tokens" style="color:var(--text-secondary);font-size:1.1rem">&#x2014;</span>';
                const lifecycleBadge = n.lifecycleEvent
                    ? `<span class="lifecycle-badge" title="Lifecycle event">${escapeHtml(n.lifecycleEvent)}</span>`
                    : '';
                const isLifecycle = !!n.lifecycleEvent;
                const hiddenAttr = isLifecycle && !showLifecycle ? ' style="display:none"' : '';
                return `
          <tr data-sub-id="${n.subscriptionId}"${isLifecycle ? ' data-lifecycle="true"' : ''}${hiddenAttr}>
            <td>${received}</td>
            <td title="${n.subscriptionId}">${escapeHtml(resource)}</td>
            <td style="text-align:center">${lifecycleBadge}</td>
            <td style="text-align:center">${validityIcon}</td>
            <td style="text-align:center">${tokenValidityIcon}</td>
            <td class="actions">
              <a href="#" class="app-detail-link" data-notif-id="${n.rowKey}" style="color:var(--primary);font-weight:600;text-decoration:none">
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
            <th>Resource</th>
            <th style="text-align:center" title="Lifecycle notification">Lifecycle</th>
            <th style="text-align:center" title="Client state">State</th>
            <th style="text-align:center" title="Validation tokens">Tokens</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

        // Attach detail handlers
        container.querySelectorAll('.app-detail-link').forEach((link) => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const notifId = (link as HTMLElement).dataset.notifId!;
                showNotificationDetail(notifId, () => APP_USER_ID);
            });
        });
    } catch (err) {
        container.innerHTML = `<div class="empty-state" style="color:var(--danger)">Error loading notifications.</div>`;
        console.error(err);
    } finally {
        if (reloadSpinner) reloadSpinner.hidden = true;
        if (btnRefresh) btnRefresh.disabled = false;
        if (btnClear) btnClear.disabled = false;
    }
}

async function clearAllAppNotifications(): Promise<void> {
    if (!confirm('Are you sure you want to delete all app notifications?')) return;

    try {
        await apiFetch('/api/app-subscriptions/notifications', {
            method: 'DELETE',
        });
        loadAppNotifications();
    } catch (err) {
        console.error('Failed to clear app notifications:', err);
        alert('Failed to clear notifications. Check the console for details.');
    }
}

function toggleAppLifecycleRows(): void {
    const chk = document.getElementById('chk-show-lifecycle-app-notifs') as HTMLInputElement;
    const container = document.getElementById('app-notifications-container')!;
    const rows = container.querySelectorAll('tr[data-lifecycle]');
    rows.forEach((row) => {
        (row as HTMLElement).style.display = chk.checked ? '' : 'none';
    });
}

export function setupAppNotificationsTableEventHandlers(): void {
    document
        .getElementById('btn-refresh-app-notifs')!
        .addEventListener('click', loadAppNotifications);
    document
        .getElementById('btn-clear-app-notifs')!
        .addEventListener('click', clearAllAppNotifications);
    document
        .getElementById('chk-show-lifecycle-app-notifs')!
        .addEventListener('change', toggleAppLifecycleRows);
}

function escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
