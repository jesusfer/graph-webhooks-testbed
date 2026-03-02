// -- Notifications Table --
// Thin wrapper that renders the NotificationsTable component for delegated
// notifications and provides the delegated-specific fetch / clear logic.

import { h, render } from 'preact';
import { apiFetch } from '../api';
import { NotificationsTable } from '../components/NotificationsTable';
import { navigate } from '../router';

interface NotificationsTableDeps {
    getUserId: () => string;
}

let deps: NotificationsTableDeps;
let refreshTrigger = 0;

export function initNotificationsTable(dependencies: NotificationsTableDeps): void {
    deps = dependencies;
}

function renderComponent(): void {
    const container = document.getElementById('notifications-root');
    if (!container) return;

    render(
        h(NotificationsTable, {
            title: 'Notifications',
            refreshTrigger,
            fetchData: async () => {
                const [notifsRes, subsRes] = await Promise.all([
                    apiFetch(`/api/notifications?userId=${encodeURIComponent(deps.getUserId())}`),
                    apiFetch(`/api/subscriptions?userId=${encodeURIComponent(deps.getUserId())}`),
                ]);
                const notifs = await notifsRes.json();
                const subs: { rowKey: string; resource: string }[] = await subsRes.json();
                return {
                    notifs,
                    subResourceMap: new Map(subs.map((s) => [s.rowKey, s.resource])),
                };
            },
            onClearAll: async () => {
                await apiFetch(
                    `/api/notifications?userId=${encodeURIComponent(deps.getUserId())}`,
                    { method: 'DELETE' },
                );
            },
            onViewDetail: (notifId: string) => {
                navigate(`/notifications/${encodeURIComponent(notifId)}`);
            },
        }),
        container,
    );
}

export function loadNotifications(): void {
    refreshTrigger++;
    renderComponent();
}

// Event handlers are now managed by the NotificationsTable component.
export function setupNotificationsTableEventHandlers(): void {}
