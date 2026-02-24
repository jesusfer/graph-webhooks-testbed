import { TableClient, TableServiceClient, odata } from '@azure/data-tables';
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

    if (!connectionString) {
        console.warn(
            'AZURE_STORAGE_CONNECTION_STRING not set - storage operations will fail at runtime.',
        );
        // Create clients anyway so the app can start; operations will throw later.
    }

    const serviceClient = TableServiceClient.fromConnectionString(
        connectionString || 'UseDevelopmentStorage=true',
    );

    // Ensure tables exist
    try {
        await serviceClient.createTable(SUBSCRIPTIONS_TABLE);
    } catch {
        // Table may already exist – ignore 409
    }
    try {
        await serviceClient.createTable(NOTIFICATIONS_TABLE);
    } catch {
        // Table may already exist – ignore 409
    }

    subscriptionsTable = TableClient.fromConnectionString(
        connectionString || 'UseDevelopmentStorage=true',
        SUBSCRIPTIONS_TABLE,
    );
    notificationsTable = TableClient.fromConnectionString(
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

export async function getSubscriptionsByUser(userId: string): Promise<SubscriptionEntity[]> {
    const entities: SubscriptionEntity[] = [];
    const iter = subscriptionsTable.listEntities<SubscriptionEntity>({
        queryOptions: { filter: odata`PartitionKey eq ${userId}` },
    });
    for await (const entity of iter) {
        entities.push(entity);
    }
    return entities;
}

export async function getSubscription(
    userId: string,
    subscriptionId: string,
): Promise<SubscriptionEntity | null> {
    try {
        const entity = await subscriptionsTable.getEntity<SubscriptionEntity>(
            userId,
            subscriptionId,
        );
        return entity;
    } catch {
        return null;
    }
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
