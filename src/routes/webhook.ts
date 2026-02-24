import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
    insertNotification,
    updateLastNotification,
    findUserForSubscription,
} from '../storage/tableStorage';
import { broadcast } from '../wsServer';
import { decryptNotificationContent, EncryptedContent } from '../decryptNotification';
import { config } from '../config';
import { validateNotificationTokens, TokenValidationResult } from '../validateTokens';

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
        // Validate JWT tokens included by Microsoft Graph (if present)
        const validationTokens: string[] = req.body?.validationTokens ?? [];
        let tokenValidationResult: TokenValidationResult | undefined;
        if (validationTokens.length > 0) {
            try {
                tokenValidationResult = await validateNotificationTokens(validationTokens);
                console.log(
                    `Validation tokens result: ${tokenValidationResult.valid ? 'PASS' : 'FAIL'} - ${tokenValidationResult.summary}`,
                );
            } catch (err) {
                console.error('Error validating notification tokens:', err);
                tokenValidationResult = {
                    valid: false,
                    summary: `Validation error: ${err}`,
                    tokens: [],
                };
            }
        }

        if (!tokenValidationResult?.valid) {
            // FUTURE the processing of this request should stop here.
            // We continue so that the notification will be processed and stored.
        }

        const notifications: any[] = req.body?.value ?? [];
        for (const notification of notifications) {
            // Validate tenantId - only process notifications from our tenant
            const notificationTenantId: string | undefined = notification.tenantId;
            if (config.entra.tenantId && notificationTenantId !== config.entra.tenantId) {
                console.warn(
                    `Skipping notification for subscription ${notification.subscriptionId ?? 'unknown'}: ` +
                        `tenantId "${notificationTenantId}" does not match configured tenant "${config.entra.tenantId}"`,
                );
                continue;
            }

            const subscriptionId: string = notification.subscriptionId ?? 'unknown';
            const receivedAt = new Date().toISOString();

            // Find which user owns this subscription so we can store it under their partition.
            // We search all subscriptions for a matching rowKey (subscriptionId).
            // In a production system you'd maintain an in-memory map or cache.
            let userId = 'unknown';
            let expectedClientState: string | undefined;
            try {
                // Brute-force: list all subscriptions and find a match.
                // This is acceptable for a testbed; not for production at scale.
                const allSubs = await findUserForSubscription(subscriptionId);
                if (allSubs) {
                    userId = allSubs.userId;
                    expectedClientState = allSubs.clientState;
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
                        `clientState mismatch for subscription ${subscriptionId}: expected "${expectedClientState}", got "${notificationClientState}"`,
                    );
                }
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
                ...(clientStateValid !== undefined ? { clientStateValid } : {}),
                ...(tokenValidationResult !== undefined
                    ? {
                          validationTokensValid: tokenValidationResult.valid,
                          validationTokensSummary: tokenValidationResult.summary,
                      }
                    : {}),
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
            broadcast('new-notification', {
                userId,
                subscriptionId,
                receivedAt,
                clientStateValid,
                validationTokensValid: tokenValidationResult?.valid,
            });
        }
    } catch (err) {
        console.error('Error processing webhook notification:', err);
    }
});
