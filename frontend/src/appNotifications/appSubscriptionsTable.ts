// -- App Subscriptions Table --
// Thin wrapper that renders the SubscriptionsTable component for app-only
// subscriptions and provides the app-specific fetch / delete / renew logic.

import { h, render } from 'preact';
import { apiFetch } from '../api';
import { SubscriptionsTable } from '../components/SubscriptionsTable';

let refreshTrigger = 0;

function renderComponent(): void {
    const container = document.getElementById('app-subscriptions-root');
    if (!container) return;

    render(
        h(SubscriptionsTable, {
            title: 'App Subscriptions',
            refreshTrigger,
            fetchSubscriptions: async () => {
                const res = await apiFetch('/api/app-subscriptions');
                return res.json();
            },
            onDelete: async (subId: string) => {
                await apiFetch(`/api/app-subscriptions/${encodeURIComponent(subId)}`, {
                    method: 'DELETE',
                });
            },
            onRenew: async (sub) => {
                const res = await apiFetch(
                    `/api/app-subscriptions/${encodeURIComponent(sub.rowKey)}/renew`,
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
                    throw new Error(`Renew failed: ${res.status}`);
                }
            },
            renewExpired: false, // Show renew for active (not expired) subs
        }),
        container,
    );
}

export function loadAppSubscriptions(): void {
    refreshTrigger++;
    renderComponent();
}

// Event handlers are now managed by the SubscriptionsTable component.
export function setupAppSubscriptionsTableEventHandlers(_onManualRefresh?: () => void): void {}
