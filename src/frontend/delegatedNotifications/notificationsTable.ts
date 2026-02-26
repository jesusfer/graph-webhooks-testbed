// -- Notifications Table --
// Handles loading and displaying the notifications table

import { showNotificationDetail } from '../detailsPage';
import { NotificationRecord } from '../types';
import { apiFetch } from '../api';

interface NotificationsTableDeps {
    getUserId: () => string;
}

let deps: NotificationsTableDeps;

export function initNotificationsTable(dependencies: NotificationsTableDeps): void {
    deps = dependencies;
}

export async function loadNotifications(): Promise<void> {
    const container = document.getElementById('notifications-container')!;
    const reloadSpinner = document.getElementById('notifs-reload-spinner');
    const isReload = !!container.querySelector('table');

    // Only show the loading placeholder on first load (no table yet)
    if (!isReload) {
        container.innerHTML = '<div class="loading">Loading...</div>';
    } else if (reloadSpinner) {
        reloadSpinner.hidden = false;
    }

    const btnRefresh = document.getElementById('btn-refresh-notifs') as HTMLButtonElement | null;
    const btnClear = document.getElementById('btn-clear-notifs') as HTMLButtonElement | null;
    if (btnRefresh) btnRefresh.disabled = true;
    if (btnClear) btnClear.disabled = true;

    try {
        const [notifsRes, subsRes] = await Promise.all([
            apiFetch(`/api/notifications?userId=${encodeURIComponent(deps.getUserId())}`),
            apiFetch(`/api/subscriptions?userId=${encodeURIComponent(deps.getUserId())}`),
        ]);
        const notifs: NotificationRecord[] = await notifsRes.json();
        const subs: { rowKey: string; resource: string }[] = await subsRes.json();
        const subResourceMap = new Map(subs.map((s) => [s.rowKey, s.resource]));

        if (notifs.length === 0) {
            container.innerHTML = '<div class="empty-state">No notifications received yet.</div>';
            return;
        }

        // Sort newest first
        notifs.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

        const lifecycleCount = notifs.filter((n) => n.lifecycleEvent).length;
        const lifecycleChk = document.getElementById(
            'chk-show-lifecycle-notifs',
        ) as HTMLInputElement | null;
        const lifecycleCountEl = document.getElementById('lifecycle-notifs-count');
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
        container.querySelectorAll('.detail-link').forEach((link) => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const notifId = (link as HTMLElement).dataset.notifId!;
                showNotificationDetail(notifId, deps.getUserId);
            });
        });
    } catch (err) {
        container.innerHTML = `<div class="empty-state" style="color:var(--danger)">Error loading notifications.</div>`;
        console.error(err);
    } finally {
        if (reloadSpinner) reloadSpinner.hidden = true;
        const btnRefresh = document.getElementById(
            'btn-refresh-notifs',
        ) as HTMLButtonElement | null;
        const btnClear = document.getElementById('btn-clear-notifs') as HTMLButtonElement | null;
        if (btnRefresh) btnRefresh.disabled = false;
        if (btnClear) btnClear.disabled = false;
    }
}

async function clearAllNotifications(): Promise<void> {
    if (!confirm('Are you sure you want to delete all notifications?')) return;

    try {
        await apiFetch(`/api/notifications?userId=${encodeURIComponent(deps.getUserId())}`, {
            method: 'DELETE',
        });
        loadNotifications();
    } catch (err) {
        console.error('Failed to clear notifications:', err);
        alert('Failed to clear notifications. Check the console for details.');
    }
}

function toggleLifecycleRows(): void {
    const chk = document.getElementById('chk-show-lifecycle-notifs') as HTMLInputElement;
    const container = document.getElementById('notifications-container')!;
    const rows = container.querySelectorAll('tr[data-lifecycle]');
    rows.forEach((row) => {
        (row as HTMLElement).style.display = chk.checked ? '' : 'none';
    });
}

export function setupNotificationsTableEventHandlers(): void {
    document.getElementById('btn-refresh-notifs')!.addEventListener('click', loadNotifications);
    document.getElementById('btn-clear-notifs')!.addEventListener('click', clearAllNotifications);
    document
        .getElementById('chk-show-lifecycle-notifs')!
        .addEventListener('change', toggleLifecycleRows);
}

function escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
