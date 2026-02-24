import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ClientSecretCredential } from '@azure/identity';
import {
    insertNotification,
    updateLastNotification,
    markSubscriptionRemoved,
    markSubscriptionNeedsReauthorization,
    clearSubscriptionNeedsReauthorization,
    updateSubscriptionExpiration,
    findUserForSubscription,
} from '../storage/tableStorage';
import { broadcast } from '../wsServer';
import { config } from '../config';

export const lifecycleWebhookRouter = Router();

/**
 * POST /api/lifecycle
 *
 * Microsoft Graph sends lifecycle notifications to this endpoint.
 * Lifecycle events include:
 *  - reauthorizationRequired - the subscription needs to be re-authorized
 *  - subscriptionRemoved     - the subscription was removed and needs to be recreated
 *  - missed                  - some notifications were missed
 *
 * Like the regular webhook, Graph first sends a validation request with
 * ?validationToken=<token> that must be echoed back with 200 text/plain.
 */
lifecycleWebhookRouter.post('/', async (req: Request, res: Response) => {
    // -- Validation handshake --
    const validationToken = req.query.validationToken as string | undefined;
    if (validationToken) {
        console.log('Lifecycle webhook validation request received');
        res.status(200).contentType('text/plain').send(validationToken);
        return;
    }

    // -- Lifecycle notification processing --
    // Respond 202 immediately so Graph doesn't retry
    res.status(202).send();

    try {
        const notifications: any[] = req.body?.value ?? [];
        for (const notification of notifications) {
            // Validate tenantId - only process notifications from our tenant
            // Docs say tenantId, but reality shows that organizationId is what we receive
            const notificationTenantId: string | undefined =
                notification.tenantId ?? notification.organizationId;
            if (config.entra.tenantId && notificationTenantId !== config.entra.tenantId) {
                console.warn(
                    `Skipping lifecycle notification for subscription ${notification.subscriptionId ?? 'unknown'}: ` +
                        `tenantId "${notificationTenantId}" does not match configured tenant "${config.entra.tenantId}"`,
                );
                continue;
            }

            const subscriptionId: string = notification.subscriptionId ?? 'unknown';
            const lifecycleEvent: string = notification.lifecycleEvent ?? 'unknown';
            const receivedAt = new Date().toISOString();

            // Find which user owns this subscription
            let userId = 'unknown';
            let expectedClientState: string | undefined;
            try {
                const result = await findUserForSubscription(subscriptionId);
                if (result) {
                    userId = result.userId;
                    expectedClientState = result.clientState;
                }
            } catch {
                // fall through - store under "unknown"
            }

            // Validate clientState
            const notificationClientState: string | undefined = notification.clientState;
            let clientStateValid: boolean | undefined;
            if (expectedClientState !== undefined) {
                clientStateValid = notificationClientState === expectedClientState;
                if (!clientStateValid) {
                    console.warn(
                        `clientState mismatch for lifecycle notification on subscription ${subscriptionId}: expected "${expectedClientState}", got "${notificationClientState}"`,
                    );
                }
            }

            console.log(
                `Lifecycle event "${lifecycleEvent}" for subscription ${subscriptionId} (user: ${userId})`,
            );

            // Handle missed notifications
            if (lifecycleEvent === 'missed') {
                // FUTURE Doesn't make sense to implement this at the moment
                // await resyncSubscription(subscriptionId);
            }

            // Handle reauthorizationRequired by PATCHing the subscription to reauthorize it
            if (lifecycleEvent === 'reauthorizationRequired') {
                const newExpiration = await reauthorizeSubscription(subscriptionId);
                if (!newExpiration && userId !== 'unknown') {
                    try {
                        await markSubscriptionNeedsReauthorization(userId, subscriptionId);
                        console.log(
                            `Marked subscription ${subscriptionId} as needing manual reauthorization`,
                        );
                    } catch {
                        // subscription record may have been deleted
                    }
                } else if (newExpiration && userId !== 'unknown') {
                    try {
                        await clearSubscriptionNeedsReauthorization(userId, subscriptionId);
                        await updateSubscriptionExpiration(userId, subscriptionId, newExpiration);
                    } catch {
                        // subscription record may have been deleted
                    }
                }
            }

            // Handle subscriptionRemoved by marking it as removed in the subscriptions table
            if (lifecycleEvent === 'subscriptionRemoved' && userId !== 'unknown') {
                try {
                    await markSubscriptionRemoved(userId, subscriptionId, receivedAt);
                    console.log(`Marked subscription ${subscriptionId} as removed`);
                } catch {
                    // subscription record may have been deleted already
                }
            }

            // Store the lifecycle notification just like a regular notification
            // so the user can see it in the notifications table
            await insertNotification({
                partitionKey: userId,
                rowKey: uuidv4(),
                subscriptionId,
                receivedAt,
                body: JSON.stringify(notification),
                lifecycleEvent,
                ...(clientStateValid !== undefined ? { clientStateValid } : {}),
            });

            // Update last notification timestamp on the subscription
            if (userId !== 'unknown') {
                try {
                    await updateLastNotification(userId, subscriptionId, receivedAt);
                } catch {
                    // subscription may have been deleted
                }
            }

            // Push real-time update to connected frontend clients
            broadcast('new-notification', {
                userId,
                subscriptionId,
                receivedAt,
                lifecycleEvent,
                clientStateValid,
            });
        }
    } catch (err) {
        console.error('Error processing lifecycle notification:', err);
    }
});

/**
 * Reauthorize a subscription by acquiring an app-only token via client credentials
 * and PATCHing the subscription with a new expiration date.
 */
async function reauthorizeSubscription(subscriptionId: string): Promise<string | null> {
    const { clientId, clientSecret, tenantId } = config.entra;

    if (!clientId || !clientSecret || !tenantId) {
        console.warn(
            `Cannot reauthorize subscription ${subscriptionId}: ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, and ENTRA_TENANT_ID must all be configured.`,
        );
        return null;
    }

    try {
        const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
        const tokenResponse = await credential.getToken('https://graph.microsoft.com/.default');

        // Extend expiration by 60 minutes from now
        const newExpiration = new Date(Date.now() + 60 * 60 * 1000).toISOString();

        const patchRes = await fetch(
            `https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`,
            {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${tokenResponse.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ expirationDateTime: newExpiration }),
            },
        );

        if (patchRes.ok) {
            const responseBody: any = await patchRes.json();
            const actualExpiration: string = responseBody.expirationDateTime ?? newExpiration;
            console.log(
                `Successfully reauthorized subscription ${subscriptionId}, new expiration: ${actualExpiration}`,
            );
            return actualExpiration;
        } else {
            const errBody = await patchRes.text();
            console.error(
                `Failed to reauthorize subscription ${subscriptionId} (${patchRes.status}): ${errBody}`,
            );
            return null;
        }
    } catch (err) {
        console.error(`Error reauthorizing subscription ${subscriptionId}:`, err);
        return null;
    }
}
