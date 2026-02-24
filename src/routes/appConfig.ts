import { Router, Request, Response } from 'express';
import { config } from '../config';

export const configRouter = Router();

/**
 * GET /api/config
 * Returns the public MSAL / Entra ID configuration needed by the frontend.
 * Never expose secrets here - only public client IDs and tenant info.
 */
configRouter.get('/', (_req: Request, res: Response) => {
    res.json({
        clientId: config.entra.clientId,
        tenantId: config.entra.tenantId,
        redirectUri: config.entra.redirectUri,
        graphNotificationUrl: config.graphNotificationUrl,
        graphLifecycleNotificationUrl: config.graphLifecycleNotificationUrl,
        hasEncryptionCertificate: !!config.graphEncryptionCertificate,
        encryptionCertificate: config.graphEncryptionCertificate,
        encryptionCertificateId: config.graphEncryptionCertificateId,
    });
});
