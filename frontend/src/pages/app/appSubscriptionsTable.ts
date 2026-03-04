// -- App Subscriptions Table --
// Thin wrapper that renders the SubscriptionsTable component for app-only
// subscriptions and provides the app-specific fetch / delete / renew logic.

import { h, render } from 'preact';
import { callBackend } from '../../services/api';
import { formatResultMessage } from '../../components/CreateSubscriptionForm';
import { SubscriptionsTable } from '../../components/SubscriptionsTable';
import { setAppCreateFormDisabled } from './createSubscription';
import { showAppResult } from './resultBox';

let refreshTrigger = 0;

function renderComponent(): void {
    const container = document.getElementById('app-subscriptions-root');
    if (!container) return;

    render(
        h(SubscriptionsTable, {
            title: 'App Subscriptions',
            refreshTrigger,
            fetchSubscriptions: async () => {
                const res = await callBackend('/api/app/subscriptions');
                return res.json();
            },
            onDelete: async (subId: string) => {
                await callBackend(`/api/app/subscriptions/${encodeURIComponent(subId)}`, {
                    method: 'DELETE',
                });
                showAppResult(
                    formatResultMessage(`Subscription deleted successfully (ID: ${subId})`, true),
                );
            },
            onRenew: async (sub) => {
                setAppCreateFormDisabled(true);
                try {
                    const res = await callBackend(
                        `/api/app/subscriptions/${encodeURIComponent(sub.rowKey)}/renew`,
                        {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ expirationMinutes: 60 }),
                        },
                    );
                    if (!res.ok) {
                        const errBody = await res.text();
                        console.error(`Failed to renew (${res.status}): ${errBody}`);
                        showAppResult(
                            formatResultMessage(
                                `Failed to renew subscription (${res.status}): ${errBody}`,
                                false,
                            ),
                        );
                        throw new Error(`Renew failed: ${res.status}`);
                    }
                    showAppResult(
                        formatResultMessage(
                            `Subscription renewed successfully (ID: ${sub.rowKey})`,
                            true,
                        ),
                    );
                } finally {
                    setAppCreateFormDisabled(false);
                }
            },
            renewExpired: true, // Show renew on expired/removed subscriptions
        }),
        container,
    );
}

export function loadAppSubscriptions(): void {
    refreshTrigger++;
    renderComponent();
}
