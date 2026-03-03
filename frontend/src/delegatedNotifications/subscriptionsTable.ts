// -- Subscriptions Table --
// Thin wrapper that renders the SubscriptionsTable component and provides
// delegated-specific behaviour (Graph API delete / reauthorize / renew).

import { h, render } from 'preact';
import { apiFetch } from '../api';
import { SubscriptionRecord, SubscriptionsTable } from '../components/SubscriptionsTable';
import { graphFetch } from '../graph';
import { createSubscription, setDelegatedCreateFormDisabled } from './createSubscription';

interface SubscriptionsTableDeps {
    getUserId: () => string;
}

let deps: SubscriptionsTableDeps;
let refreshTrigger = 0;

export function initSubscriptionsTable(dependencies: SubscriptionsTableDeps): void {
    deps = dependencies;
}

function renderComponent(): void {
    const container = document.getElementById('subscriptions-root');
    if (!container) return;

    render(
        h(SubscriptionsTable, {
            title: 'My Subscriptions',
            refreshTrigger,
            autoRefreshIntervalMs: 60_000,
            fetchSubscriptions: async () => {
                const res = await apiFetch(
                    `/api/subscriptions?userId=${encodeURIComponent(deps.getUserId())}`,
                );
                return res.json();
            },
            onDelete: async (subId: string, isExpired: boolean) => {
                if (!isExpired) {
                    try {
                        const graphRes = await graphFetch(
                            `/v1.0/subscriptions/${encodeURIComponent(subId)}`,
                            { method: 'DELETE' },
                        );
                        if (!graphRes.ok && graphRes.status !== 404) {
                            const errBody = await graphRes.text();
                            console.warn(`Graph delete returned ${graphRes.status}: ${errBody}`);
                        }
                    } catch (graphErr) {
                        console.warn('Failed to delete subscription from Graph:', graphErr);
                    }
                }
                await apiFetch(
                    `/api/subscriptions/${encodeURIComponent(subId)}?userId=${encodeURIComponent(deps.getUserId())}`,
                    { method: 'DELETE' },
                );
                removeHighlightsForSubscription(subId);
            },
            onRenew: async (sub: SubscriptionRecord) => {
                setDelegatedCreateFormDisabled(true);
                try {
                    await createSubscription(
                        sub.resource,
                        sub.changeType,
                        60,
                        sub.includeResourceData ?? false,
                    );
                } finally {
                    setDelegatedCreateFormDisabled(false);
                }
            },
            renewExpired: true,
            onReauthorize: async (subId: string) => {
                const newExpiration = new Date(Date.now() + 60 * 60 * 1000).toISOString();
                const graphRes = await graphFetch(
                    `/v1.0/subscriptions/${encodeURIComponent(subId)}`,
                    {
                        method: 'PATCH',
                        body: JSON.stringify({ expirationDateTime: newExpiration }),
                    },
                );
                if (!graphRes.ok) {
                    const errBody = await graphRes.text();
                    console.error(`Failed to reauthorize (${graphRes.status}): ${errBody}`);
                    alert(`Failed to reauthorize subscription: ${graphRes.status}`);
                    throw new Error(`Reauthorize failed: ${graphRes.status}`);
                }
                const graphBody = await graphRes.json();
                await apiFetch(
                    `/api/subscriptions/${encodeURIComponent(subId)}/reauthorize?userId=${encodeURIComponent(deps.getUserId())}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            expirationDateTime: graphBody.expirationDateTime,
                        }),
                    },
                );
            },
            onRowClick: highlightNotificationsForSubscription,
        }),
        container,
    );
}

export function loadSubscriptions(): void {
    refreshTrigger++;
    renderComponent();
}

// -- Highlight helpers (operate on DOM rendered by the component) --

export function highlightNotificationsForSubscription(subscriptionId: string): void {
    const notifsContainer = document.getElementById('notifications-root');
    const subsContainer = document.getElementById('subscriptions-root');
    if (!notifsContainer || !subsContainer) return;

    const notifRows = notifsContainer.querySelectorAll('tr[data-sub-id]');
    const subRows = subsContainer.querySelectorAll('tr[data-sub-row]');
    let anyHighlighted = false;

    notifRows.forEach((row) => {
        const rowSubId = (row as HTMLElement).dataset.subId;
        if (rowSubId === subscriptionId) {
            row.classList.toggle('highlight');
            if (row.classList.contains('highlight')) anyHighlighted = true;
        } else {
            row.classList.remove('highlight');
        }
    });

    subRows.forEach((row) => {
        const rowSubId = (row as HTMLElement).dataset.subRow;
        if (rowSubId === subscriptionId) {
            row.classList.toggle('highlight', anyHighlighted);
        } else {
            row.classList.remove('highlight');
        }
    });

    if (anyHighlighted) {
        notifsContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function removeHighlightsForSubscription(subscriptionId: string): void {
    const container = document.getElementById('notifications-root');
    if (!container) return;
    container.querySelectorAll(`tr[data-sub-id="${subscriptionId}"]`).forEach((row) => {
        row.classList.remove('highlight');
    });
}

// Event handlers are now managed by the SubscriptionsTable component.
export function setupSubscriptionsTableEventHandlers(_onManualRefresh?: () => void): void {}
