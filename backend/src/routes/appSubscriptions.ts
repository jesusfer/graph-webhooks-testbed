import { Request, Response, Router } from 'express';
import { config } from '../config';
import {
    deleteAllNotificationsByUser,
    deleteNotificationsBySubscription,
    deleteSubscription,
    getNotification,
    getNotificationsByUser,
    getSubscriptionsByUser,
    SubscriptionEntity,
    updateSubscriptionExpiration,
    upsertSubscription,
} from '../storage/tableStorage';
import { callGraph } from '../util/graph';
import {
    asChangeType,
    asGuid,
    asPositiveInt,
    asResourcePath,
    ValidationError,
} from '../util/validateParams';

export const appRouter = Router();

const APP_USER_ID = '__app__';

/**
 * POST /api/app/subscriptions
 *
 * Creates a Graph subscription using client_credentials (app-only) auth.
 *
 * Body: { resource, changeType, expirationMinutes, includeResourceData? }
 */
appRouter.post('/subscriptions', async (req: Request, res: Response) => {
    const { includeResourceData } = req.body;

    let resource: string;
    let changeType: string;
    let expMinutes: number;
    try {
        resource = asResourcePath(req.body.resource, 'resource');
        changeType = asChangeType(req.body.changeType, 'changeType');
        expMinutes = asPositiveInt(req.body.expirationMinutes, 'expirationMinutes', 60);
    } catch (err) {
        res.status(400).json({
            error: err instanceof ValidationError ? err.message : 'Invalid parameters',
        });
        return;
    }
    const expirationDateTime = new Date(Date.now() + expMinutes * 60 * 1000).toISOString();

    const notificationUrl = config.graphNotificationUrl;
    if (!notificationUrl) {
        res.status(500).json({
            error: 'GRAPH_NOTIFICATION_URL is not configured on the server.',
        });
        return;
    }

    const clientState = crypto.randomUUID();

    const graphPayload: Record<string, unknown> = {
        changeType,
        notificationUrl,
        resource,
        expirationDateTime,
        clientState,
    };

    // Add lifecycle notification URL if configured
    if (config.graphLifecycleNotificationUrl) {
        graphPayload.lifecycleNotificationUrl = config.graphLifecycleNotificationUrl;
    }

    if (includeResourceData) {
        if (!config.graphEncryptionCertificate) {
            res.status(400).json({
                error: 'GRAPH_ENCRYPTION_CERTIFICATE is not configured. Cannot use includeResourceData.',
            });
            return;
        }
        graphPayload.includeResourceData = true;
        graphPayload.encryptionCertificate = config.graphEncryptionCertificate;
        graphPayload.encryptionCertificateId = config.graphEncryptionCertificateId;
    }

    try {
        const graphRes = await callGraph('/v1.0/subscriptions', {
            method: 'POST',
            body: JSON.stringify(graphPayload),
        });

        if (!graphRes.ok) {
            const errBody = await graphRes.text();
            res.status(graphRes.status).json({
                error: `Graph API error (${graphRes.status}): ${errBody}`,
            });
            return;
        }

        const graphSub = (await graphRes.json()) as Record<string, any>;

        // Store in our backend database under the app user id
        const entity: SubscriptionEntity = {
            partitionKey: APP_USER_ID,
            rowKey: graphSub.id,
            resource: graphSub.resource ?? '',
            changeType: graphSub.changeType ?? '',
            expirationDateTime: graphSub.expirationDateTime ?? '',
            notificationUrl: graphSub.notificationUrl ?? '',
            createdAt: new Date().toISOString(),
            ...(includeResourceData ? { includeResourceData: true } : {}),
            ...(clientState ? { clientState } : {}),
        };

        await upsertSubscription(entity);

        res.status(201).json(graphSub);
    } catch (err: any) {
        console.error('Error creating app subscription:', err);
        res.status(500).json({ error: err.message || String(err) });
    }
});

/**
 * GET /api/app/subscriptions
 * List all app-only subscriptions.
 */
appRouter.get('/subscriptions', async (_req: Request, res: Response) => {
    try {
        const subs = await getSubscriptionsByUser(APP_USER_ID);
        subs.sort(
            (a, b) =>
                new Date(a.expirationDateTime).getTime() - new Date(b.expirationDateTime).getTime(),
        );
        res.json(subs);
    } catch (err: any) {
        console.error('Error listing app subscriptions:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/app/subscriptions/:subscriptionId
 * Delete an app subscription from Graph and remove the local record.
 */
appRouter.delete('/subscriptions/:subscriptionId', async (req: Request, res: Response) => {
    let subscriptionId: string;
    try {
        const rawSubId = Array.isArray(req.params.subscriptionId)
            ? req.params.subscriptionId[0]
            : req.params.subscriptionId;
        subscriptionId = asGuid(rawSubId, 'subscriptionId');
    } catch (err) {
        res.status(400).json({
            error: err instanceof ValidationError ? err.message : 'Invalid subscriptionId',
        });
        return;
    }

    try {
        // Try to delete from Graph (ignore 404 if already gone)
        const graphRes = await callGraph(
            `/v1.0/subscriptions/${encodeURIComponent(subscriptionId)}`,
            { method: 'DELETE' },
        );
        if (!graphRes.ok && graphRes.status !== 404) {
            const errBody = await graphRes.text();
            console.warn(`Graph delete returned ${graphRes.status}: ${errBody}`);
        }
    } catch (graphErr) {
        console.warn('Failed to delete subscription from Graph:', graphErr);
    }

    try {
        await deleteSubscription(APP_USER_ID, subscriptionId);
        try {
            const deleted = await deleteNotificationsBySubscription(APP_USER_ID, subscriptionId);
            if (deleted > 0) {
                console.log(
                    `Deleted ${deleted} notification(s) for app subscription ${subscriptionId}`,
                );
            }
        } catch (notifErr) {
            console.warn('Failed to delete notifications for app subscription:', notifErr);
        }
        res.status(204).send();
    } catch (err: any) {
        console.error('Error deleting app subscription:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * PATCH /api/app/subscriptions/:subscriptionId/renew
 * Renew an app subscription by extending its expiration via Graph.
 *
 * For active subscriptions this sends a PATCH to Graph.  For expired
 * subscriptions a PATCH is not allowed by Graph, so the handler creates
 * a brand-new subscription with the same parameters instead.
 *
 * Body: { expirationMinutes? } — defaults to 60
 */
appRouter.patch('/subscriptions/:subscriptionId/renew', async (req: Request, res: Response) => {
    let subscriptionId: string;
    let expMinutes: number;
    try {
        const rawSubId = Array.isArray(req.params.subscriptionId)
            ? req.params.subscriptionId[0]
            : req.params.subscriptionId;
        subscriptionId = asGuid(rawSubId, 'subscriptionId');
        expMinutes = asPositiveInt(req.body?.expirationMinutes, 'expirationMinutes', 60);
    } catch (err) {
        res.status(400).json({
            error: err instanceof ValidationError ? err.message : 'Invalid parameters',
        });
        return;
    }

    // Look up the existing local record so we know if it has expired and can
    // re-use its parameters when creating a replacement subscription.
    let existingSub: SubscriptionEntity | undefined;
    try {
        const existingSubs = await getSubscriptionsByUser(APP_USER_ID, subscriptionId);
        existingSub = existingSubs[0] ?? undefined;
    } catch (err: any) {
        console.error('Error looking up app subscription for renewal:', err);
        res.status(500).json({ error: err.message || String(err) });
        return;
    }

    if (!existingSub) {
        res.status(400).json({
            error: `Subscription ${subscriptionId} not found. Cannot renew a subscription that does not exist locally.`,
        });
        return;
    }

    const isExpired =
        existingSub &&
        (new Date(existingSub.expirationDateTime).getTime() < Date.now() ||
            !!existingSub.removedAt);

    if (isExpired && existingSub) {
        // ---- Expired: create a replacement subscription ----
        const newExpiration = new Date(Date.now() + expMinutes * 60 * 1000).toISOString();
        const notificationUrl = config.graphNotificationUrl;
        if (!notificationUrl) {
            res.status(500).json({
                error: 'GRAPH_NOTIFICATION_URL is not configured on the server.',
            });
            return;
        }

        const clientState = crypto.randomUUID();
        const graphPayload: Record<string, unknown> = {
            changeType: existingSub.changeType,
            notificationUrl,
            resource: existingSub.resource,
            expirationDateTime: newExpiration,
            clientState,
        };

        if (config.graphLifecycleNotificationUrl) {
            graphPayload.lifecycleNotificationUrl = config.graphLifecycleNotificationUrl;
        }

        if (existingSub.includeResourceData) {
            if (!config.graphEncryptionCertificate) {
                res.status(400).json({
                    error: 'GRAPH_ENCRYPTION_CERTIFICATE is not configured. Cannot use includeResourceData.',
                });
                return;
            }
            graphPayload.includeResourceData = true;
            graphPayload.encryptionCertificate = config.graphEncryptionCertificate;
            graphPayload.encryptionCertificateId = config.graphEncryptionCertificateId;
        }

        try {
            const graphRes = await callGraph('/v1.0/subscriptions', {
                method: 'POST',
                body: JSON.stringify(graphPayload),
            });

            if (!graphRes.ok) {
                const errBody = await graphRes.text();
                res.status(graphRes.status).json({
                    error: `Graph API error (${graphRes.status}): ${errBody}`,
                });
                return;
            }

            const graphSub = (await graphRes.json()) as Record<string, any>;

            // Store the new subscription
            const entity: SubscriptionEntity = {
                partitionKey: APP_USER_ID,
                rowKey: graphSub.id,
                resource: graphSub.resource ?? '',
                changeType: graphSub.changeType ?? '',
                expirationDateTime: graphSub.expirationDateTime ?? '',
                notificationUrl: graphSub.notificationUrl ?? '',
                createdAt: new Date().toISOString(),
                ...(existingSub.includeResourceData ? { includeResourceData: true } : {}),
                ...(clientState ? { clientState } : {}),
            };
            await upsertSubscription(entity);

            res.status(201).json(graphSub);
        } catch (err: any) {
            console.error('Error creating replacement app subscription:', err);
            res.status(500).json({ error: err.message || String(err) });
        }
    } else {
        // ---- Active: PATCH to extend expiration ----
        const newExpiration = new Date(Date.now() + expMinutes * 60 * 1000).toISOString();
        try {
            const graphRes = await callGraph(
                `/v1.0/subscriptions/${encodeURIComponent(subscriptionId)}`,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ expirationDateTime: newExpiration }),
                },
            );

            if (!graphRes.ok) {
                const errBody = await graphRes.text();
                res.status(graphRes.status).json({
                    error: `Graph API error (${graphRes.status}): ${errBody}`,
                });
                return;
            }

            const graphSub = (await graphRes.json()) as Record<string, any>;

            await updateSubscriptionExpiration(
                APP_USER_ID,
                subscriptionId,
                graphSub.expirationDateTime,
            );

            res.json(graphSub);
        } catch (err: any) {
            console.error('Error renewing app subscription:', err);
            res.status(500).json({ error: err.message || String(err) });
        }
    }
});

/**
 * GET /api/app/notifications
 * List all notifications for app subscriptions.
 */
appRouter.get('/notifications', async (_req: Request, res: Response) => {
    try {
        const notifications = await getNotificationsByUser(APP_USER_ID);
        res.json(notifications);
    } catch (err: any) {
        console.error('Error listing app notifications:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/app/notifications/:notificationId
 * Get a single app notification's full details.
 */
appRouter.get('/notifications/:notificationId', async (req: Request, res: Response) => {
    let notificationId: string;
    try {
        const rawId = Array.isArray(req.params.notificationId)
            ? req.params.notificationId[0]
            : req.params.notificationId;
        notificationId = asGuid(rawId, 'notificationId');
    } catch (err) {
        res.status(400).json({
            error: err instanceof ValidationError ? err.message : 'Invalid notificationId',
        });
        return;
    }

    try {
        const notification = await getNotification(APP_USER_ID, notificationId);
        if (!notification) {
            res.status(404).json({ error: 'Notification not found' });
            return;
        }
        res.json(notification);
    } catch (err: any) {
        console.error('Error getting app notification:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/app/notifications
 * Delete all notifications for app subscriptions.
 */
appRouter.delete('/notifications', async (_req: Request, res: Response) => {
    try {
        const count = await deleteAllNotificationsByUser(APP_USER_ID);
        res.json({ deleted: count });
    } catch (err: any) {
        console.error('Error deleting app notifications:', err);
        res.status(500).json({ error: err.message });
    }
});
