import { TableClient, TableServiceClient, odata } from '@azure/data-tables';
import { DefaultAzureCredential } from '@azure/identity';
import { config } from '../config';

const SUBSCRIPTIONS_TABLE = 'Subscriptions';
const NOTIFICATIONS_TABLE = 'Notifications';

let subscriptionsTable: TableClient;
let notificationsTable: TableClient;

/**
 * Initialize Azure Table Storage clients and ensure tables exist.
 */
export async function initializeStorage(): Promise<void> {
    const connectionString = config.storageConnectionString;
    const managedIdentityEnabled = config.useManagedIdentity;

    let serviceClient: TableServiceClient;
    let credential: DefaultAzureCredential | undefined;
    let tableEndpoint: string | undefined;

    if (managedIdentityEnabled) {
        const accountName = config.storageAccountName;
        if (!accountName) {
            throw new Error(
                'AZURE_STORAGE_ACCOUNT_NAME must be set when AZURE_STORAGE_USE_MANAGED_IDENTITY is enabled.',
            );
        }

        tableEndpoint =
            config.storageTableEndpoint || `https://${accountName}.table.core.windows.net`;
        try {
            const parsedEndpoint = new URL(tableEndpoint);
            if (parsedEndpoint.protocol !== 'https:') {
                throw new Error('the endpoint must use HTTPS');
            }
            tableEndpoint = tableEndpoint.replace(/\/+$/, '');
        } catch (error) {
            const reason = error instanceof Error ? error.message : 'invalid URL';
            throw new Error(`AZURE_STORAGE_TABLE_ENDPOINT is invalid: ${reason}`);
        }

        credential = new DefaultAzureCredential({
            managedIdentityClientId: config.managedIdentityClientId || undefined,
        });

        serviceClient = new TableServiceClient(tableEndpoint, credential);

        console.log('Azure Table Storage initialized using managed identity');
    } else {
        if (!connectionString) {
            console.warn(
                'AZURE_STORAGE_CONNECTION_STRING not set - storage operations will fail at runtime.',
            );
            // Create clients anyway so the app can start; operations will throw later.
        }

        serviceClient = TableServiceClient.fromConnectionString(
            connectionString || 'UseDevelopmentStorage=true',
        );
    }

    // Ensure tables exist
    try {
        await serviceClient.createTable(SUBSCRIPTIONS_TABLE);
    } catch {
        // Table may already exist - ignore 409
    }
    try {
        await serviceClient.createTable(NOTIFICATIONS_TABLE);
    } catch {
        // Table may already exist - ignore 409
    }

    subscriptionsTable = managedIdentityEnabled
        ? new TableClient(tableEndpoint!, SUBSCRIPTIONS_TABLE, credential!)
        : TableClient.fromConnectionString(
              connectionString || 'UseDevelopmentStorage=true',
              SUBSCRIPTIONS_TABLE,
          );

    notificationsTable = managedIdentityEnabled
        ? new TableClient(tableEndpoint!, NOTIFICATIONS_TABLE, credential!)
        : TableClient.fromConnectionString(
              connectionString || 'UseDevelopmentStorage=true',
              NOTIFICATIONS_TABLE,
          );

    console.log('Azure Table Storage initialized');
}

// ----------------------------------------------
// Subscription helpers
// ----------------------------------------------

export interface SubscriptionEntity {
    partitionKey: string; // userId
    rowKey: string; // subscriptionId
    resource: string;
    changeType: string;
    expirationDateTime: string;
    notificationUrl: string;
    createdAt: string;
    lastNotificationAt?: string;
    includeResourceData?: boolean;
    clientState?: string;
    removedAt?: string; // set when Graph sends a subscriptionRemoved lifecycle event
    needsReauthorization?: boolean; // set when automatic reauthorization fails
}

export async function upsertSubscription(entity: SubscriptionEntity): Promise<void> {
    await subscriptionsTable.upsertEntity(entity, 'Merge');
}

/**
 * Search across all users' subscriptions to find which user owns a given subscriptionId.
 */
export async function findUserForSubscription(
    subscriptionId: string,
): Promise<{ userId: string; clientState?: string } | null> {
    const iter = subscriptionsTable.listEntities({
        queryOptions: { filter: odata`RowKey eq ${subscriptionId}` },
    });

    for await (const entity of iter) {
        return {
            userId: entity.partitionKey as string,
            clientState: entity.clientState as string | undefined,
        };
    }

    return null;
}

export async function getSubscriptionsByUser(
    userId: string,
    subscriptionId?: string,
): Promise<SubscriptionEntity[]> {
    const filter = subscriptionId
        ? odata`PartitionKey eq ${userId} and RowKey eq ${subscriptionId}`
        : odata`PartitionKey eq ${userId}`;
    const entities: SubscriptionEntity[] = [];
    const iter = subscriptionsTable.listEntities<SubscriptionEntity>({
        queryOptions: { filter },
    });
    for await (const entity of iter) {
        entities.push(entity);
    }
    return entities;
}

export async function deleteSubscription(userId: string, subscriptionId: string): Promise<void> {
    await subscriptionsTable.deleteEntity(userId, subscriptionId);
}

export async function updateLastNotification(
    userId: string,
    subscriptionId: string,
    timestamp: string,
): Promise<void> {
    await subscriptionsTable.updateEntity(
        {
            partitionKey: userId,
            rowKey: subscriptionId,
            lastNotificationAt: timestamp,
        },
        'Merge',
    );
}

export async function markSubscriptionNeedsReauthorization(
    userId: string,
    subscriptionId: string,
): Promise<void> {
    await subscriptionsTable.updateEntity(
        {
            partitionKey: userId,
            rowKey: subscriptionId,
            needsReauthorization: true,
        },
        'Merge',
    );
}

export async function clearSubscriptionNeedsReauthorization(
    userId: string,
    subscriptionId: string,
): Promise<void> {
    await subscriptionsTable.updateEntity(
        {
            partitionKey: userId,
            rowKey: subscriptionId,
            needsReauthorization: false,
        },
        'Merge',
    );
}

export async function updateSubscriptionExpiration(
    userId: string,
    subscriptionId: string,
    expirationDateTime: string,
): Promise<void> {
    await subscriptionsTable.updateEntity(
        {
            partitionKey: userId,
            rowKey: subscriptionId,
            expirationDateTime,
        },
        'Merge',
    );
}

export async function markSubscriptionRemoved(
    userId: string,
    subscriptionId: string,
    timestamp: string,
): Promise<void> {
    await subscriptionsTable.updateEntity(
        {
            partitionKey: userId,
            rowKey: subscriptionId,
            removedAt: timestamp,
        },
        'Merge',
    );
}

// ----------------------------------------------
// Notification helpers
// ----------------------------------------------

export interface NotificationEntity {
    partitionKey: string; // userId
    rowKey: string; // unique notification id (uuid)
    subscriptionId: string;
    receivedAt: string;
    body: string; // JSON-stringified notification body
    decryptedResourceData?: string; // JSON-stringified decrypted resource (rich notifications)
    clientStateValid?: boolean; // whether the notification's clientState matched the subscription's
    lifecycleEvent?: string; // lifecycle event type (e.g. reauthorizationRequired, subscriptionRemoved, missed)
    validationTokensValid?: boolean; // whether the JWT validation tokens in the payload passed validation
    validationTokensSummary?: string; // human-readable summary of validation token checks
}

export async function insertNotification(entity: NotificationEntity): Promise<void> {
    await notificationsTable.createEntity(entity);
}

export async function getNotificationsByUser(userId: string): Promise<NotificationEntity[]> {
    const entities: NotificationEntity[] = [];
    const iter = notificationsTable.listEntities<NotificationEntity>({
        queryOptions: { filter: odata`PartitionKey eq ${userId}` },
    });
    for await (const entity of iter) {
        entities.push(entity);
    }
    return entities;
}

export async function getNotification(
    userId: string,
    notificationId: string,
): Promise<NotificationEntity | null> {
    try {
        const entity = await notificationsTable.getEntity<NotificationEntity>(
            userId,
            notificationId,
        );
        return entity;
    } catch {
        return null;
    }
}

export async function deleteAllNotificationsByUser(userId: string): Promise<number> {
    const entities = await getNotificationsByUser(userId);
    await Promise.all(
        entities.map((entity) =>
            notificationsTable.deleteEntity(entity.partitionKey, entity.rowKey),
        ),
    );
    return entities.length;
}

export async function deleteNotificationsBySubscription(
    userId: string,
    subscriptionId: string,
): Promise<number> {
    const entities = await getNotificationsByUser(userId);
    const matching = entities.filter((e) => e.subscriptionId === subscriptionId);
    await Promise.all(
        matching.map((entity) =>
            notificationsTable.deleteEntity(entity.partitionKey, entity.rowKey),
        ),
    );
    return matching.length;
}
