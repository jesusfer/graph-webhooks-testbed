import { Router, Request, Response } from 'express';
import {
    upsertSubscription,
    getSubscriptionsByUser,
    deleteSubscription,
    SubscriptionEntity,
} from '../storage/tableStorage';

export const subscriptionsRouter = Router();

/**
 * GET /api/subscriptions?userId=<userId>
 * List all subscriptions for the authenticated user.
 */
subscriptionsRouter.get('/', async (req: Request, res: Response) => {
    const userId = req.query.userId as string;
    if (!userId) {
        res.status(400).json({ error: 'userId query parameter is required' });
        return;
    }

    try {
        const subs = await getSubscriptionsByUser(userId);
        res.json(subs);
    } catch (err: any) {
        console.error('Error listing subscriptions:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/subscriptions
 * Store a subscription record after the frontend has created it via Graph API.
 *
 * Body: { userId, subscriptionId, resource, changeType, expirationDateTime, notificationUrl }
 */
subscriptionsRouter.post('/', async (req: Request, res: Response) => {
    const { userId, subscriptionId, resource, changeType, expirationDateTime, notificationUrl, includeResourceData } =
        req.body;

    if (!userId || !subscriptionId) {
        res.status(400).json({ error: 'userId and subscriptionId are required' });
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
 * DELETE /api/subscriptions/:subscriptionId?userId=<userId>
 * Remove a subscription record.
 */
subscriptionsRouter.delete('/:subscriptionId', async (req: Request, res: Response) => {
    const userId = req.query.userId as string;
    const { subscriptionId } = req.params;

    if (!userId) {
        res.status(400).json({ error: 'userId query parameter is required' });
        return;
    }

    try {
        await deleteSubscription(userId, subscriptionId);
        res.status(204).send();
    } catch (err: any) {
        console.error('Error deleting subscription:', err);
        res.status(500).json({ error: err.message });
    }
});
