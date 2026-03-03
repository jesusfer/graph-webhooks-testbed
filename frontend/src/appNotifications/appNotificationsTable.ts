// -- App Notifications Table --
// Thin wrapper that renders the NotificationsTable component for app-only
// notifications and provides the app-specific fetch / clear logic.

import { h, render } from 'preact';
import { callBackend } from '../services/api';
import { NotificationsTable } from '../components/NotificationsTable';
import { navigate } from '../router';

let refreshTrigger = 0;

function renderComponent(): void {
    const container = document.getElementById('app-notifications-root');
    if (!container) return;

    render(
        h(NotificationsTable, {
            title: 'Notifications',
            refreshTrigger,
            fetchData: async () => {
                const [notifsRes, subsRes] = await Promise.all([
                    callBackend('/api/app-subscriptions/notifications'),
                    callBackend('/api/app-subscriptions'),
                ]);
                const notifs = await notifsRes.json();
                const subs: { rowKey: string; resource: string }[] = await subsRes.json();
                return {
                    notifs,
                    subResourceMap: new Map(subs.map((s) => [s.rowKey, s.resource])),
                };
            },
            onClearAll: async () => {
                await callBackend('/api/app-subscriptions/notifications', {
                    method: 'DELETE',
                });
            },
            onViewDetail: (notifId: string) => {
                navigate(`/notifications/${encodeURIComponent(notifId)}`);
            },
        }),
        container,
    );
}

export function loadAppNotifications(): void {
    refreshTrigger++;
    renderComponent();
}

// Event handlers are now managed by the NotificationsTable component.
export function setupAppNotificationsTableEventHandlers(): void {}
