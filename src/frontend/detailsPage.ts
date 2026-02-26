// -- Details Page --
// Handles the notification detail view functionality

import { NotificationRecord } from './types';
import { apiFetch } from './api';

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
        const res = await apiFetch(
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

    // Back button
    document.getElementById('back-to-main')!.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('detail-section')!.style.display = 'none';
        document.getElementById('app-section')!.style.display = 'block';
    });
}
