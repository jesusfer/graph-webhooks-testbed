import { Request, Response, Router } from 'express';
import {
    clearSubscriptionNeedsReauthorization,
    deleteNotificationsBySubscription,
    deleteSubscription,
    getSubscriptionsByUser,
    SubscriptionEntity,
    updateSubscriptionExpiration,
    upsertSubscription,
} from '../storage/tableStorage';
import { asGuid, ValidationError } from '../util/validateParams';

export const delegatedRouter = Router();

/**
 * GET /api/delegated/subscriptions?userId=<userId>
 * List all subscriptions for the authenticated user.
 */
delegatedRouter.get('/subscriptions', async (req: Request, res: Response) => {
    let userId: string;
    try {
        userId = asGuid(req.query.userId, 'userId');
    } catch (err) {
        res.status(400).json({
            error: err instanceof ValidationError ? err.message : 'Invalid userId',
        });
        return;
    }

    try {
        const subs = await getSubscriptionsByUser(userId);
        subs.sort(
            (a, b) =>
                new Date(a.expirationDateTime).getTime() - new Date(b.expirationDateTime).getTime(),
        );
        res.json(subs);
    } catch (err: any) {
        console.error('Error listing subscriptions:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/delegated/subscriptions
 * Store a subscription record after the frontend has created it via Graph API.
 *
 * Body: { userId, subscriptionId, resource, changeType, expirationDateTime, notificationUrl }
 */
delegatedRouter.post('/subscriptions', async (req: Request, res: Response) => {
    const {
        resource,
        changeType,
        expirationDateTime,
        notificationUrl,
        includeResourceData,
        clientState,
    } = req.body;

    let userId: string;
    let subscriptionId: string;
    try {
        userId = asGuid(req.body.userId, 'userId');
        subscriptionId = asGuid(req.body.subscriptionId, 'subscriptionId');
    } catch (err) {
        res.status(400).json({
            error: err instanceof ValidationError ? err.message : 'Invalid parameters',
        });
        return;
    }

    const entity: SubscriptionEntity = {
        partitionKey: userId,
        rowKey: subscriptionId,
        resource: resource ?? '',
        changeType: changeType ?? '',
        expirationDateTime: expirationDateTime ?? '',
        notificationUrl: notificationUrl ?? '',
        createdAt: new Date().toISOString(),
        ...(includeResourceData ? { includeResourceData: true } : {}),
        ...(clientState ? { clientState } : {}),
    };

    try {
        await upsertSubscription(entity);
        res.status(201).json(entity);
    } catch (err: any) {
        console.error('Error creating subscription record:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/delegated/subscriptions/:subscriptionId/reauthorize?userId=<userId>
 * Clear the needsReauthorization flag after the user has manually reauthorized
 * the subscription via the Graph API from the frontend.
 */
delegatedRouter.post(
    '/subscriptions/:subscriptionId/reauthorize',
    async (req: Request, res: Response) => {
        const { expirationDateTime } = req.body ?? {};

        let userId: string;
        let subscriptionId: string;
        try {
            userId = asGuid(req.query.userId, 'userId');
            const rawSubId = Array.isArray(req.params.subscriptionId)
                ? req.params.subscriptionId[0]
                : req.params.subscriptionId;
            subscriptionId = asGuid(rawSubId, 'subscriptionId');
        } catch (err) {
            res.status(400).json({
                error: err instanceof ValidationError ? err.message : 'Invalid parameters',
            });
            return;
        }

        try {
            await clearSubscriptionNeedsReauthorization(userId, subscriptionId);
            if (expirationDateTime) {
                await updateSubscriptionExpiration(userId, subscriptionId, expirationDateTime);
            }
            res.status(200).json({ success: true });
        } catch (err: any) {
            console.error('Error clearing reauthorization flag:', err);
            res.status(500).json({ error: err.message });
        }
    },
);

/**
 * DELETE /api/delegated/subscriptions/:subscriptionId?userId=<userId>
 * Remove a subscription record.
 */
delegatedRouter.delete('/subscriptions/:subscriptionId', async (req: Request, res: Response) => {
    let userId: string;
    let subscriptionId: string;
    try {
        userId = asGuid(req.query.userId, 'userId');
        const rawSubId = Array.isArray(req.params.subscriptionId)
            ? req.params.subscriptionId[0]
            : req.params.subscriptionId;
        subscriptionId = asGuid(rawSubId, 'subscriptionId');
    } catch (err) {
        res.status(400).json({
            error: err instanceof ValidationError ? err.message : 'Invalid parameters',
        });
        return;
    }

    try {
        await deleteSubscription(userId, subscriptionId);
        // Cascade-delete all notifications belonging to this subscription
        try {
            const deleted = await deleteNotificationsBySubscription(userId, subscriptionId);
            if (deleted > 0) {
                console.log(
                    `Deleted ${deleted} notification(s) for subscription ${subscriptionId}`,
                );
            }
        } catch (notifErr) {
            console.warn('Failed to delete notifications for subscription:', notifErr);
        }
        res.status(204).send();
    } catch (err: any) {
        console.error('Error deleting subscription:', err);
        res.status(500).json({ error: err.message });
    }
});
