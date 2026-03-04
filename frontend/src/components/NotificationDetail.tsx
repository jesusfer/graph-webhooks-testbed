// -- Notification Detail Component --
// Renders the notification detail view: metadata, JSON body, line-wrap toggle,
// and a back link.

import { useCallback, useEffect, useState } from 'preact/hooks';
import { callBackend } from '../services/api';
import { NotificationRecord } from '../types';
import { formatDateTime } from './formats';

export interface NotificationDetailProps {
    /** The notification ID to display */
    notificationId: string;
    /** Returns the current user's ID (used for the delegated endpoint) */
    getUserId: () => string;
    /** Called when the user clicks the back link */
    onBack: (isApp: boolean) => void;
}

export function NotificationDetail({ notificationId, getUserId, onBack }: NotificationDetailProps) {
    const [notif, setNotif] = useState<NotificationRecord | null>(null);
    const [isApp, setIsApp] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lineWrap, setLineWrap] = useState(false);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setNotif(null);
            setError(null);

            try {
                let appOrigin = false;
                let res = await callBackend(
                    `/api/notifications/${encodeURIComponent(notificationId)}?userId=${encodeURIComponent(getUserId())}`,
                );
                if (!res.ok) {
                    res = await callBackend(
                        `/api/app-subscriptions/notifications/${encodeURIComponent(notificationId)}`,
                    );
                    appOrigin = true;
                }

                if (cancelled) return;

                if (!res.ok) {
                    setError(`Failed to load notification (HTTP ${res.status}).`);
                    return;
                }

                setIsApp(appOrigin);
                setNotif(await res.json());
            } catch (err) {
                if (cancelled) return;
                console.error(err);
                setError('Error loading notification details.');
            }
        }

        load();
        return () => {
            cancelled = true;
        };
    }, [notificationId, getUserId]);

    const handleBack = useCallback(
        (e: Event) => {
            e.preventDefault();
            if (history.length > 1) {
                history.back();
            } else {
                onBack(isApp);
            }
        },
        [onBack, isApp],
    );

    const handleLineWrapChange = useCallback((e: Event) => {
        setLineWrap((e.target as HTMLInputElement).checked);
    }, []);

    // Format the JSON body for display
    let bodyText: string;
    if (error) {
        bodyText = error;
    } else if (!notif) {
        bodyText = 'Loading...';
    } else {
        try {
            bodyText = JSON.stringify(JSON.parse(notif.body), null, 2);
        } catch {
            bodyText = notif.body;
        }
    }

    return (
        <div class="card">
            <a class="back-link" href="/" onClick={handleBack}>
                ← Back to dashboard
            </a>
            <h2>Notification Details</h2>

            {notif && (
                <dl class="detail-meta">
                    <dt>Notification ID</dt>
                    <dd>{notif.rowKey}</dd>
                    <dt>Subscription ID</dt>
                    <dd>{notif.subscriptionId}</dd>
                    <dt>Received At</dt>
                    <dd>{formatDateTime(new Date(notif.receivedAt))}</dd>
                </dl>
            )}

            <label class="wrap-toggle">
                <input type="checkbox" checked={lineWrap} onChange={handleLineWrapChange} /> Enable
                line wrapping
            </label>

            <pre class={lineWrap ? 'line-wrap' : ''}>{bodyText}</pre>
        </div>
    );
}
