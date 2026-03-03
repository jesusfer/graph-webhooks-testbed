// -- Details Page --
// Handles the notification detail view functionality

import { callBackend } from './services/api';
import { navigate } from './router';
import { NotificationRecord } from './types';

/** Tracks whether the currently displayed notification came from the app endpoint. */
let currentNotificationIsApp = false;

function escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

export async function showNotificationDetail(
    notificationId: string,
    getUserId: () => string,
): Promise<void> {
    const appSection = document.getElementById('app-section')!;
    const detailSection = document.getElementById('detail-section')!;
    const detailMeta = document.getElementById('detail-meta')!;
    const detailBody = document.getElementById('detail-body')!;

    appSection.style.display = 'none';
    detailSection.style.display = 'block';
    detailBody.textContent = 'Loading...';
    detailMeta.innerHTML = '';

    try {
        // Try the delegated notifications endpoint first, then fall back to app notifications
        let isApp = false;
        let res = await callBackend(
            `/api/notifications/${encodeURIComponent(notificationId)}?userId=${encodeURIComponent(getUserId())}`,
        );
        if (!res.ok) {
            res = await callBackend(
                `/api/app-subscriptions/notifications/${encodeURIComponent(notificationId)}`,
            );
            isApp = true;
        }
        currentNotificationIsApp = isApp;
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

export function setupDetailsPageEventHandlers(): void {
    // Line wrap toggle
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

    // Back button — go back in history if possible, otherwise navigate to the
    // section that owns the current notification
    document.getElementById('back-to-main')!.addEventListener('click', (e) => {
        e.preventDefault();
        if (history.length > 1) {
            history.back();
        } else {
            navigate(currentNotificationIsApp ? '/app' : '/delegated');
        }
    });
}
