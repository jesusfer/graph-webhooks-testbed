import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
    insertNotification,
    updateLastNotification,
    getSubscriptionsByUser,
} from '../storage/tableStorage';
import { broadcast } from '../wsServer';
import { decryptNotificationContent, EncryptedContent } from '../decryptNotification';
import { config } from '../config';

export const webhookRouter = Router();

/**
 * POST /api/webhook
 *
 * Microsoft Graph sends:
 *  - A validation request with ?validationToken=<token> (must respond 200 with the token)
 *  - Notification payloads as JSON with a `value` array
 *
 * For each notification we:
 *  1. Store the full body in the Notifications table
 *  2. Update the lastNotificationAt field on the parent subscription
 */
webhookRouter.post('/', async (req: Request, res: Response) => {
    // -- Validation handshake --
    const validationToken = req.query.validationToken as string | undefined;
    if (validationToken) {
        console.log('Webhook validation request received');
        res.status(200).contentType('text/plain').send(validationToken);
        return;
    }

    // -- Notification processing --
    // Respond 202 immediately so Graph doesn't retry
    res.status(202).send();

    try {
        // TODO only getting value means we will not get access to validationTokens
        const notifications: any[] = req.body?.value ?? [];
        for (const notification of notifications) {
            const subscriptionId: string = notification.subscriptionId ?? 'unknown';
            const receivedAt = new Date().toISOString();

            // Find which user owns this subscription so we can store it under their partition.
            // We search all subscriptions for a matching rowKey (subscriptionId).
            // In a production system you'd maintain an in-memory map or cache.
            let userId = 'unknown';
            try {
                // Brute-force: list all subscriptions and find a match.
                // This is acceptable for a testbed; not for production at scale.
                const allSubs = await findUserForSubscription(subscriptionId);
                if (allSubs) userId = allSubs;
            } catch {
                // fall through – store under "unknown"
            }

            // Attempt to decrypt encryptedContent if present and PFX is configured
            let decrypted: any | undefined;
            if (notification.encryptedContent && config.graphEncryptionPfx) {
                try {
                    const encrypted: EncryptedContent = notification.encryptedContent;
                    decrypted = decryptNotificationContent(encrypted);
                    console.log(`Decrypted resource data for subscription ${subscriptionId}`);
                } catch (decryptErr) {
                    console.error(
                        `Failed to decrypt notification for subscription ${subscriptionId}:`,
                        decryptErr,
                    );
                }
            }

            const storedBody = decrypted
                ? {
                      ...notification,
                      decryptedContent: decrypted,
                  }
                : notification;

            await insertNotification({
                partitionKey: userId,
                rowKey: uuidv4(),
                subscriptionId,
                receivedAt,
                body: JSON.stringify(storedBody),
            });

            // Update last notification timestamp on the subscription
            if (userId !== 'unknown') {
                try {
                    await updateLastNotification(userId, subscriptionId, receivedAt);
                } catch {
                    // subscription may have been deleted
                }
            }

            console.log(`Stored notification for subscription ${subscriptionId} (user: ${userId})`);

            // Push real-time update to connected frontend clients
            broadcast('new-notification', { userId, subscriptionId, receivedAt });
        }
    } catch (err) {
        console.error('Error processing webhook notification:', err);
    }
});

/**
 * Search across all users' subscriptions to find which user owns a given subscriptionId.
 * Returns the userId (partitionKey) or null.
 */
async function findUserForSubscription(subscriptionId: string): Promise<string | null> {
    // We import here to avoid circular deps at startup
    const { TableClient, odata } = await import('@azure/data-tables');
    const { config } = await import('../config');

    const table = TableClient.fromConnectionString(
        config.storageConnectionString || 'UseDevelopmentStorage=true',
        'Subscriptions',
    );

    const iter = table.listEntities({
        queryOptions: { filter: odata`RowKey eq ${subscriptionId}` },
    });

    for await (const entity of iter) {
        return entity.partitionKey as string;
    }

    return null;
}
