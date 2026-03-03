// -- Create Delegated Subscription --
// Handles delegated subscription creation functionality

import { h, render } from 'preact';
import { apiFetch } from '../api';
import { CreateSubscriptionForm, SubmitResult } from '../components/CreateSubscriptionForm';
import { formatResultMessage } from '../components/CreateSubscriptionForm';
import { graphFetch } from '../graph';
import { AppConfig } from '../types';
import { showDelegatedResult } from './resultBox';

interface CreateSubscriptionDeps {
    getAppConfig: () => AppConfig | null;
    getUserId: () => string;
    onSubscriptionCreated: () => void;
}

let deps: CreateSubscriptionDeps;
let formDisabled = false;

export function initCreateSubscription(dependencies: CreateSubscriptionDeps): void {
    deps = dependencies;
}

/**
 * Enable or disable the create-subscription form from outside (e.g. while a
 * renewal is in progress).
 */
export function setDelegatedCreateFormDisabled(disabled: boolean): void {
    formDisabled = disabled;
    renderDelegatedCreateSubscriptionForm();
}

/**
 * Programmatically create a delegated subscription (e.g. when renewing an expired one).
 * Returns a result indicating success or failure.
 */
export async function createSubscription(
    resource: string,
    changeType: string,
    expirationMinutes: number,
    includeResourceData: boolean = false,
): Promise<SubmitResult> {
    return doCreateSubscription(resource, changeType, expirationMinutes, includeResourceData);
}

async function doCreateSubscription(
    resource: string,
    changeType: string,
    expirationMinutes: number,
    includeResourceData: boolean,
): Promise<SubmitResult> {
    const expirationDateTime = new Date(Date.now() + expirationMinutes * 60 * 1000).toISOString();

    const appConfig = deps.getAppConfig();
    const notificationUrl = appConfig?.graphNotificationUrl || '';
    if (!notificationUrl) {
        return {
            success: false,
            message:
                'GRAPH_NOTIFICATION_URL is not configured on the server. Set it in your .env file to the public URL of your /api/webhook endpoint.',
        };
    }

    // Generate a random clientState for validation
    const clientState = crypto.randomUUID();

    // Call Microsoft Graph to create the subscription
    const graphPayload: Record<string, unknown> = {
        changeType,
        notificationUrl,
        resource,
        expirationDateTime,
        clientState,
    };

    // Add lifecycle notification URL if configured
    const lifecycleNotificationUrl = appConfig?.graphLifecycleNotificationUrl || '';
    if (lifecycleNotificationUrl) {
        graphPayload.lifecycleNotificationUrl = lifecycleNotificationUrl;
    }

    if (includeResourceData) {
        if (!appConfig?.hasEncryptionCertificate) {
            return {
                success: false,
                message:
                    'GRAPH_ENCRYPTION_CERTIFICATE is not configured on the server. Set it in your .env file to enable rich notifications with resource data.',
            };
        }
        graphPayload.includeResourceData = true;
        graphPayload.encryptionCertificate = appConfig.encryptionCertificate;
        graphPayload.encryptionCertificateId = appConfig.encryptionCertificateId;
    }

    try {
        const graphRes = await graphFetch('/v1.0/subscriptions', {
            method: 'POST',
            body: JSON.stringify(graphPayload),
        });

        if (!graphRes.ok) {
            const errBody = await graphRes.text();
            return { success: false, message: `Graph API error (${graphRes.status}): ${errBody}` };
        }

        const graphSub = await graphRes.json();

        // Store in our backend database
        await apiFetch('/api/subscriptions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: deps.getUserId(),
                subscriptionId: graphSub.id,
                resource: graphSub.resource,
                changeType: graphSub.changeType,
                expirationDateTime: graphSub.expirationDateTime,
                notificationUrl: graphSub.notificationUrl,
                clientState,
                ...(includeResourceData ? { includeResourceData: true } : {}),
            }),
        });

        deps.onSubscriptionCreated();
        return {
            success: true,
            message: `Subscription created successfully (ID: ${graphSub.id}, expires: ${new Date(graphSub.expirationDateTime).toLocaleString()})`,
        };
    } catch (err) {
        console.error('Failed to create subscription:', err);
        return {
            success: false,
            message: `Failed to create subscription: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

export function renderDelegatedCreateSubscriptionForm(): void {
    const container = document.getElementById('delegated-create-subscription-root');
    if (!container) return;

    render(
        h(CreateSubscriptionForm, {
            resourcePlaceholder: 'e.g. me/messages',
            disabled: formDisabled,
            onSubmit: doCreateSubscription,
            onResult: showDelegatedResult,
        }),
        container,
    );
}
