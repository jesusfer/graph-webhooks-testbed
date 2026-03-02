import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { formatDateTime } from './formats';

export interface SubscriptionRecord {
    partitionKey: string;
    rowKey: string;
    resource: string;
    changeType: string;
    expirationDateTime: string;
    notificationUrl: string;
    createdAt: string;
    lastNotificationAt?: string;
    includeResourceData?: boolean;
    removedAt?: string;
    needsReauthorization?: boolean;
}

export interface SubscriptionsTableProps {
    /** Card heading */
    title: string;
    /** Increment to trigger a data refresh from outside */
    refreshTrigger?: number;
    /** Fetches the subscriptions list */
    fetchSubscriptions: () => Promise<SubscriptionRecord[]>;
    /** Called when user confirms deletion */
    onDelete: (subId: string, isExpired: boolean) => Promise<void>;
    /** Called when user clicks Renew */
    onRenew?: (sub: SubscriptionRecord) => Promise<void>;
    /**
     * When true (default), the Renew button appears on expired / removed
     * subscriptions.  When false it appears on active ones instead.
     */
    renewExpired?: boolean;
    /** Called when user clicks Reauthorize */
    onReauthorize?: (subId: string) => Promise<void>;
    /** Called when user clicks a subscription row */
    onRowClick?: (subId: string) => void;
    /** If set, the component auto-refreshes on this interval (ms) */
    autoRefreshIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const changeTypeColors: Record<string, string> = {
    created: '#107c10',
    updated: '#0078d4',
    deleted: '#d13438',
};
const changeTypeDefaultColor = '#8764b8';

function ChangeTypeTags({ changeType }: { changeType: string }) {
    return (
        <>
            {changeType
                .split(',')
                .map((ct) => ct.trim())
                .filter(Boolean)
                .map((ct) => {
                    const color = changeTypeColors[ct.toLowerCase()] ?? changeTypeDefaultColor;
                    return (
                        <span key={ct} class="change-type-tag" style={{ background: color }}>
                            {ct}
                        </span>
                    );
                })}
        </>
    );
}

function formatTimeRemaining(expiryDate: Date): string {
    const diffMs = expiryDate.getTime() - Date.now();
    if (diffMs <= 0) return 'expired';

    const totalSeconds = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

    return parts.join(' ') + ' remaining';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SubscriptionsTable({
    title,
    refreshTrigger = 0,
    fetchSubscriptions,
    onDelete,
    onRenew,
    renewExpired = true,
    onReauthorize,
    onRowClick,
    autoRefreshIntervalMs,
}: SubscriptionsTableProps) {
    const [subs, setSubs] = useState<SubscriptionRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [showExpired, setShowExpired] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [renewingId, setRenewingId] = useState<string | null>(null);
    const [reauthorizingId, setReauthorizingId] = useState<string | null>(null);
    const [internalTrigger, setInternalTrigger] = useState(0);

    const spinnerRef = useRef<HTMLSpanElement>(null);
    const fetchRef = useRef(fetchSubscriptions);
    fetchRef.current = fetchSubscriptions;
    const loadedOnce = useRef(false);

    const doFetch = useCallback(async () => {
        if (loadedOnce.current) {
            setRefreshing(true);
        }
        setError(false);
        try {
            const data = await fetchRef.current();
            setSubs(data);
            loadedOnce.current = true;
        } catch (err) {
            setError(true);
            console.error(err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    // Fetch data on mount, when triggers change, and manage auto-refresh
    useEffect(() => {
        doFetch();

        if (autoRefreshIntervalMs && autoRefreshIntervalMs > 0) {
            // Reset spinner CSS animation
            const spinner = spinnerRef.current;
            if (spinner) {
                spinner.style.animationName = 'none';
                void spinner.offsetHeight;
                spinner.style.animationName = '';
            }

            const id = setInterval(() => {
                doFetch();
                if (spinnerRef.current) {
                    spinnerRef.current.style.animationName = 'none';
                    void spinnerRef.current.offsetHeight;
                    spinnerRef.current.style.animationName = '';
                }
            }, autoRefreshIntervalMs);

            return () => clearInterval(id);
        }
    }, [refreshTrigger, internalTrigger, autoRefreshIntervalMs, doFetch]);

    // -- Handlers --

    const handleRefresh = useCallback(() => {
        setInternalTrigger((prev) => prev + 1);
    }, []);

    const handleDelete = useCallback(
        async (sub: SubscriptionRecord) => {
            if (!confirm('Delete this subscription record?')) return;
            const isExpired =
                new Date(sub.expirationDateTime).getTime() < Date.now() || !!sub.removedAt;
            setDeletingId(sub.rowKey);
            try {
                await onDelete(sub.rowKey, isExpired);
                doFetch();
            } catch (err) {
                console.error('Error deleting subscription:', err);
            } finally {
                setDeletingId(null);
            }
        },
        [onDelete, doFetch],
    );

    const handleRenew = useCallback(
        async (sub: SubscriptionRecord) => {
            if (!onRenew) return;
            setRenewingId(sub.rowKey);
            try {
                await onRenew(sub);
                doFetch();
            } catch (err) {
                console.error('Error renewing subscription:', err);
                alert('Error renewing subscription. See console for details.');
            } finally {
                setRenewingId(null);
            }
        },
        [onRenew, doFetch],
    );

    const handleReauthorize = useCallback(
        async (subId: string) => {
            if (!onReauthorize) return;
            setReauthorizingId(subId);
            try {
                await onReauthorize(subId);
                doFetch();
            } catch (err) {
                console.error('Error reauthorizing subscription:', err);
                alert('Error reauthorizing subscription. See console for details.');
            } finally {
                setReauthorizingId(null);
            }
        },
        [onReauthorize, doFetch],
    );

    // -- Derived state --

    const expiredCount = subs.filter((s) => {
        const isExpired = new Date(s.expirationDateTime).getTime() < Date.now();
        return isExpired || !!s.removedAt;
    }).length;

    const filteredSubs = showExpired
        ? subs
        : subs.filter((s) => {
              const isExpired = new Date(s.expirationDateTime).getTime() < Date.now();
              return !isExpired && !s.removedAt;
          });

    // Sort: active first (closest to expire), then expired (most recently expired first)
    const sortedSubs = [...filteredSubs].sort((a, b) => {
        const now = Date.now();
        const aExpiry = new Date(a.expirationDateTime).getTime();
        const bExpiry = new Date(b.expirationDateTime).getTime();
        const aIsExpired = aExpiry < now || !!a.removedAt;
        const bIsExpired = bExpiry < now || !!b.removedAt;

        if (aIsExpired !== bIsExpired) return aIsExpired ? 1 : -1;
        if (!aIsExpired) return aExpiry - bExpiry;
        return bExpiry - aExpiry;
    });

    // -- Render --

    let content;
    if (loading) {
        content = <div class="loading">Loading...</div>;
    } else if (error) {
        content = (
            <div class="empty-state" style="color:var(--danger)">
                Error loading subscriptions.
            </div>
        );
    } else if (subs.length === 0) {
        content = <div class="empty-state">No subscriptions yet. Create one above.</div>;
    } else if (sortedSubs.length === 0) {
        content = (
            <div class="empty-state">
                No active subscriptions. {subs.length} expired subscription(s) hidden.
            </div>
        );
    } else {
        content = (
            <table>
                <thead>
                    <tr>
                        <th>Resource</th>
                        <th>Change Type</th>
                        <th style="text-align:center">Resource Data</th>
                        <th>Expires</th>
                        <th>Last Notification</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {sortedSubs.map((sub) => {
                        const expiryDate = new Date(sub.expirationDateTime);
                        const isExpired = expiryDate.getTime() < Date.now();
                        const isRemoved = !!sub.removedAt;
                        const lastNotif = sub.lastNotificationAt
                            ? formatDateTime(new Date(sub.lastNotificationAt))
                            : '\u2014';

                        const showRenew =
                            onRenew &&
                            (renewExpired ? isExpired || isRemoved : !isExpired && !isRemoved);
                        const showReauthorize =
                            onReauthorize && sub.needsReauthorization && !isExpired && !isRemoved;

                        return (
                            <tr
                                key={sub.rowKey}
                                data-sub-row={sub.rowKey}
                                onClick={onRowClick ? () => onRowClick(sub.rowKey) : undefined}
                                style={onRowClick ? { cursor: 'pointer' } : undefined}
                            >
                                <td title={sub.rowKey}>{sub.resource}</td>
                                <td>
                                    <ChangeTypeTags changeType={sub.changeType} />
                                </td>
                                <td
                                    style="text-align:center"
                                    title={
                                        sub.includeResourceData
                                            ? 'Include resource data enabled'
                                            : 'Include resource data disabled'
                                    }
                                >
                                    {sub.includeResourceData ? '\uD83D\uDD12' : ''}
                                </td>
                                <td style="white-space:nowrap">
                                    {formatDateTime(expiryDate)}
                                    <br />
                                    {isRemoved ? (
                                        <strong style="color:var(--danger)">(removed)</strong>
                                    ) : isExpired ? (
                                        <strong style="color:var(--danger)">(expired)</strong>
                                    ) : (
                                        <span style="opacity:0.7">
                                            ({formatTimeRemaining(expiryDate)})
                                        </span>
                                    )}
                                </td>
                                <td style="white-space:nowrap">{lastNotif}</td>
                                <td class="actions">
                                    <button
                                        class="btn-danger btn-small"
                                        disabled={deletingId === sub.rowKey}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDelete(sub);
                                        }}
                                    >
                                        {deletingId === sub.rowKey ? 'Deleting...' : 'Delete'}
                                    </button>
                                    {showReauthorize && (
                                        <button
                                            class="btn-warning btn-small"
                                            disabled={reauthorizingId === sub.rowKey}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleReauthorize(sub.rowKey);
                                            }}
                                        >
                                            {reauthorizingId === sub.rowKey
                                                ? 'Reauthorizing...'
                                                : 'Reauthorize'}
                                        </button>
                                    )}
                                    {showRenew && (
                                        <button
                                            class="btn-primary btn-small"
                                            disabled={renewingId === sub.rowKey}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleRenew(sub);
                                            }}
                                        >
                                            {renewingId === sub.rowKey ? 'Renewing...' : 'Renew'}
                                        </button>
                                    )}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label
                        class="checkbox-label"
                        style={{
                            fontSize: '0.85rem',
                            margin: 0,
                            cursor: 'pointer',
                            userSelect: 'none',
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={showExpired}
                            onChange={() => setShowExpired((v) => !v)}
                        />{' '}
                        Show expired {expiredCount > 0 && <span>({expiredCount})</span>}
                    </label>
                    {autoRefreshIntervalMs && (
                        <span ref={spinnerRef} class="refresh-timer-spinner" />
                    )}
                    <button
                        class="btn-secondary btn-small"
                        onClick={handleRefresh}
                        disabled={refreshing}
                    >
                        Refresh
                    </button>
                </div>
            </div>
            {content}
        </div>
    );
}
