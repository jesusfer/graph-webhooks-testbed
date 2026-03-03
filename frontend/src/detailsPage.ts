// -- Details Page --
// Thin wrapper that renders the NotificationDetail component into the DOM.

import { h, render } from 'preact';
import { NotificationDetail } from './components/NotificationDetail';
import { navigate } from './router';

export function showNotificationDetail(notificationId: string, getUserId: () => string): void {
    const container = document.getElementById('detail-section');
    if (!container) return;

    render(
        h(NotificationDetail, {
            notificationId,
            getUserId,
            onBack: (isApp: boolean) => {
                navigate(isApp ? '/app' : '/delegated');
            },
        }),
        container,
    );
}

// Event handlers are now managed by the NotificationDetail component.
export function setupDetailsPageEventHandlers(): void {}
