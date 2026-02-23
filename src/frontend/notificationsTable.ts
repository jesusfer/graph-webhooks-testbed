// -- Notifications Table --
// Handles loading and displaying the notifications table

import { showNotificationDetail } from './detailsPage';

interface NotificationRecord {
    partitionKey: string;
    rowKey: string;
    subscriptionId: string;
    receivedAt: string;
    body: string;
}

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
        const res = await fetch(`/api/notifications?userId=${encodeURIComponent(deps.getUserId())}`);
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
