import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { NotificationRecord } from '../types';
import { formatDateTime } from './formats';

export interface NotificationsTableProps {
    /** Card heading */
    title: string;
    /** Increment to trigger a data refresh from outside */
    refreshTrigger?: number;
    /** Fetches notifications and the subscription-to-resource mapping */
    fetchData: () => Promise<{
        notifs: NotificationRecord[];
        subResourceMap: Map<string, string>;
    }>;
    /** Called when user confirms Clear All */
    onClearAll: () => Promise<void>;
    /** Called when user clicks View Details on a notification */
    onViewDetail: (notifId: string) => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ValidityIcon({
    valid,
    validTitle,
    invalidTitle,
    unknownTitle,
}: {
    valid?: boolean;
    validTitle: string;
    invalidTitle: string;
    unknownTitle: string;
}) {
    if (valid === true) {
        return (
            <span title={validTitle} class="validity-icon validity-icon-valid">
                {'\u2705'}
            </span>
        );
    }
    if (valid === false) {
        return (
            <span title={invalidTitle} class="validity-icon validity-icon-invalid">
                {'\u274C'}
            </span>
        );
    }
    return (
        <span title={unknownTitle} class="validity-icon validity-icon-unknown">
            {'\u2014'}
        </span>
    );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NotificationsTable({
    title,
    refreshTrigger = 0,
    fetchData,
    onClearAll,
    onViewDetail,
}: NotificationsTableProps) {
    const [notifs, setNotifs] = useState<NotificationRecord[]>([]);
    const [subResourceMap, setSubResourceMap] = useState<Map<string, string>>(new Map());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [showLifecycle, setShowLifecycle] = useState(false);

    const fetchRef = useRef(fetchData);
    fetchRef.current = fetchData;
    const loadedOnce = useRef(false);

    const doFetch = useCallback(async () => {
        if (loadedOnce.current) {
            setRefreshing(true);
        }
        setError(false);
        try {
            const data = await fetchRef.current();
            setNotifs(data.notifs);
            setSubResourceMap(data.subResourceMap);
            loadedOnce.current = true;
        } catch (err) {
            setError(true);
            console.error(err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        doFetch();
    }, [refreshTrigger, doFetch]);

    // -- Handlers --

    const handleRefresh = useCallback(() => {
        doFetch();
    }, [doFetch]);

    const handleClearAll = useCallback(async () => {
        if (!confirm('Are you sure you want to delete all notifications?')) return;
        try {
            await onClearAll();
            doFetch();
        } catch (err) {
            console.error('Failed to clear notifications:', err);
            alert('Failed to clear notifications. Check the console for details.');
        }
    }, [onClearAll, doFetch]);

    // -- Derived state --

    // Sort newest first
    const sortedNotifs = [...notifs].sort(
        (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
    );

    const lifecycleCount = notifs.filter((n) => n.lifecycleEvent).length;

    // -- Render --

    let content;
    if (loading) {
        content = <div class="loading">Loading...</div>;
    } else if (error) {
        content = (
            <div class="empty-state empty-state-error">
                Error loading notifications.
            </div>
        );
    } else if (notifs.length === 0) {
        content = <div class="empty-state">No notifications received yet.</div>;
    } else {
        content = (
            <table>
                <thead>
                    <tr>
                        <th>Received At</th>
                        <th>Resource</th>
                        <th class="text-center" title="Lifecycle notification">
                            Lifecycle
                        </th>
                        <th class="text-center" title="Client state">
                            State
                        </th>
                        <th class="text-center" title="Validation tokens">
                            Tokens
                        </th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {sortedNotifs.map((n) => {
                        const isLifecycle = !!n.lifecycleEvent;
                        if (isLifecycle && !showLifecycle) return null;

                        const received = formatDateTime(new Date(n.receivedAt));
                        const resource = subResourceMap.get(n.subscriptionId) ?? n.subscriptionId;

                        return (
                            <tr
                                key={n.rowKey}
                                data-sub-id={n.subscriptionId}
                                data-lifecycle={isLifecycle ? 'true' : undefined}
                            >
                                <td>{received}</td>
                                <td title={n.subscriptionId}>{resource}</td>
                                <td class="text-center">
                                    {n.lifecycleEvent && (
                                        <span class="lifecycle-badge" title="Lifecycle event">
                                            {n.lifecycleEvent}
                                        </span>
                                    )}
                                </td>
                                <td class="text-center">
                                    <ValidityIcon
                                        valid={n.clientStateValid}
                                        validTitle="clientState valid"
                                        invalidTitle="clientState mismatch"
                                        unknownTitle="clientState not checked"
                                    />
                                </td>
                                <td class="text-center">
                                    <ValidityIcon
                                        valid={n.validationTokensValid}
                                        validTitle={n.validationTokensSummary ?? 'Tokens valid'}
                                        invalidTitle={
                                            n.validationTokensSummary ?? 'Token validation failed'
                                        }
                                        unknownTitle="No validation tokens"
                                    />
                                </td>
                                <td class="actions">
                                    <a
                                        href="#"
                                        class="view-details-link"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            onViewDetail(n.rowKey);
                                        }}
                                    >
                                        View Details
                                    </a>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        );
    }

    return (
        <div class="card">
            <div class="section-header">
                <h2>
                    {title}
                    {refreshing && <span class="reload-spinner" />}
                </h2>
                <div class="section-header-actions">
                    <label
                        class="checkbox-label"
                    >
                        <input
                            type="checkbox"
                            checked={showLifecycle}
                            onChange={() => setShowLifecycle((v) => !v)}
                        />{' '}
                        Show lifecycle {lifecycleCount > 0 && <span>({lifecycleCount})</span>}
                    </label>
                    <button
                        class="btn-secondary btn-small"
                        onClick={handleRefresh}
                        disabled={refreshing}
                    >
                        Refresh
                    </button>
                    <button
                        class="btn-danger btn-small"
                        onClick={handleClearAll}
                        disabled={refreshing}
                    >
                        Clear All
                    </button>
                </div>
            </div>
            {content}
        </div>
    );
}
