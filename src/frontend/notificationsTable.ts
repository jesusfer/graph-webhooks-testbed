// -- Notifications Table --
// Handles loading and displaying the notifications table

import { showNotificationDetail } from './detailsPage';
import { NotificationRecord } from './types';

interface NotificationsTableDeps {
    getUserId: () => string;
}

let deps: NotificationsTableDeps;

export function initNotificationsTable(dependencies: NotificationsTableDeps): void {
    deps = dependencies;
}

export async function loadNotifications(): Promise<void> {
    const container = document.getElementById('notifications-container')!;
    container.innerHTML = '<div class="loading">Loading...</div>';

    try {
        const [notifsRes, subsRes] = await Promise.all([
            fetch(`/api/notifications?userId=${encodeURIComponent(deps.getUserId())}`),
            fetch(`/api/subscriptions?userId=${encodeURIComponent(deps.getUserId())}`),
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

        const rows = notifs
            .map((n) => {
                const received = new Date(n.receivedAt).toLocaleString();
                const resource = subResourceMap.get(n.subscriptionId) ?? n.subscriptionId;
                const validityIcon = n.clientStateValid === true
                    ? '<span title="clientState valid" style="color:var(--success);font-size:1.1rem">&#x2705;</span>'
                    : n.clientStateValid === false
                        ? '<span title="clientState mismatch" style="color:var(--danger);font-size:1.1rem">&#x274C;</span>'
                        : '<span title="clientState not checked" style="color:var(--text-secondary);font-size:1.1rem">&#x2014;</span>';
                return `
          <tr data-sub-id="${n.subscriptionId}">
            <td>${received}</td>
            <td title="${n.subscriptionId}">${escapeHtml(resource)}</td>
            <td style="text-align:center">${validityIcon}</td>
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
            <th style="text-align:center">Valid</th>
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
    }
}

async function clearAllNotifications(): Promise<void> {
    if (!confirm('Are you sure you want to delete all notifications?')) return;

    try {
        await fetch(`/api/notifications?userId=${encodeURIComponent(deps.getUserId())}`, {
            method: 'DELETE',
        });
        loadNotifications();
    } catch (err) {
        console.error('Failed to clear notifications:', err);
        alert('Failed to clear notifications. Check the console for details.');
    }
}

export function setupNotificationsTableEventHandlers(): void {
    document.getElementById('btn-refresh-notifs')!.addEventListener('click', loadNotifications);
    document.getElementById('btn-clear-notifs')!.addEventListener('click', clearAllNotifications);
}

function escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
