import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

export const config = {
    port: parseInt(process.env.PORT || '3000', 10),
    sessionSecret: process.env.SESSION_SECRET || 'change-me',

    // Entra ID
    entra: {
        clientId: process.env.ENTRA_CLIENT_ID || '',
        clientSecret: process.env.ENTRA_CLIENT_SECRET || '',
        tenantId: process.env.ENTRA_TENANT_ID || '',
        redirectUri: process.env.ENTRA_REDIRECT_URI || 'http://localhost:3000',
    },

    // Azure Storage
    storageConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || '',
    storageAccountName: process.env.AZURE_STORAGE_ACCOUNT_NAME || '',
    useManagedIdentity:
        process.env.AZURE_STORAGE_USE_MANAGED_IDENTITY === 'true' ||
        process.env.AZURE_STORAGE_USE_MANAGED_IDENTITY === '1',
    managedIdentityClientId:
        process.env.AZURE_CLIENT_ID || process.env.AZURE_STORAGE_MANAGED_IDENTITY_CLIENT_ID || '',

    // Graph
    graphNotificationUrl: process.env.GRAPH_NOTIFICATION_URL || '',
    graphLifecycleNotificationUrl: process.env.GRAPH_LIFECYCLE_NOTIFICATION_URL || '',

    // Encryption certificate for rich notifications (base64-encoded)
    graphEncryptionCertificate: process.env.GRAPH_ENCRYPTION_CERTIFICATE || '',
    graphEncryptionCertificateId: process.env.GRAPH_ENCRYPTION_CERTIFICATE_ID || '',

    // PFX (PKCS#12) file for decrypting rich notification payloads (base64-encoded)
    graphEncryptionPfx: process.env.GRAPH_ENCRYPTION_PFX || '',
    graphEncryptionPfxPassword: process.env.GRAPH_ENCRYPTION_PFX_PASSWORD || '',

    // API protection
    apiAudience: process.env.API_AUDIENCE || '',
    apiScope: process.env.API_SCOPE || '',

    // Reverse proxy
    trustProxy: parseInt(process.env.TRUST_PROXY || '1', 10),

    // Rate limiting
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // default 15 minutes
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
};
