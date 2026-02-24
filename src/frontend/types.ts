// -- Shared Types --
// Common interfaces used across multiple frontend modules

export interface AppConfig {
    clientId: string;
    tenantId: string;
    redirectUri: string;
    graphNotificationUrl: string;
    graphLifecycleNotificationUrl: string;
    hasEncryptionCertificate: boolean;
    encryptionCertificate: string;
    encryptionCertificateId: string;
}

export interface NotificationRecord {
    partitionKey: string;
    rowKey: string;
    subscriptionId: string;
    receivedAt: string;
    body: string;
    clientStateValid?: boolean;
    lifecycleEvent?: string;
    validationTokensValid?: boolean;
    validationTokensSummary?: string;
}
