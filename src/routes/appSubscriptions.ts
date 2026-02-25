import { Router, Request, Response } from 'express';
import { config } from '../config';
import { upsertSubscription, SubscriptionEntity } from '../storage/tableStorage';
import { graphAppFetch } from '../util/graph';

export const appSubscriptionsRouter = Router();

const APP_USER_ID = '__app__';

/**
 * POST /api/app-subscriptions
 *
 * Creates a Graph subscription using client_credentials (app-only) auth.
 *
 * Body: { resource, changeType, expirationMinutes, includeResourceData? }
 */
appSubscriptionsRouter.post('/', async (req: Request, res: Response) => {
    const { resource, changeType, expirationMinutes, includeResourceData } = req.body;

    if (!resource || !changeType) {
        res.status(400).json({ error: 'resource and changeType are required' });
        return;
    }

    const expMinutes = parseInt(expirationMinutes, 10) || 60;
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
        const graphRes = await graphAppFetch('/v1.0/subscriptions', {
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
