// -- Create App Subscription --
// Handles app-only subscription creation functionality

import { h, render } from 'preact';
import { callBackend } from '../services/api';
import { CreateSubscriptionForm, SubmitResult } from '../components/CreateSubscriptionForm';
import { AppConfig } from '../types';
import { showAppResult } from './resultBox';

interface CreateAppSubscriptionDeps {
    getAppConfig: () => AppConfig | null;
    onAppSubscriptionCreated?: () => void;
}

let deps: CreateAppSubscriptionDeps;
let formDisabled = false;

export function initAppCreateSubscription(dependencies: CreateAppSubscriptionDeps): void {
    deps = dependencies;
}

/**
 * Enable or disable the create-subscription form from outside (e.g. while a
 * renewal is in progress).
 */
export function setAppCreateFormDisabled(disabled: boolean): void {
    formDisabled = disabled;
    renderAppCreateSubscriptionForm();
}

async function doCreateAppSubscription(
    resource: string,
    changeType: string,
    expirationMinutes: number,
    includeResourceData: boolean,
): Promise<SubmitResult> {
    try {
        const res = await callBackend('/api/app-subscriptions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                resource,
                changeType,
                expirationMinutes,
                includeResourceData,
            }),
        });

        if (!res.ok) {
            const errBody = await res.text();
            return { success: false, message: `Error (${res.status}): ${errBody}` };
        }

        const graphSub = await res.json();
        deps.onAppSubscriptionCreated?.();
        return {
            success: true,
            message: `Subscription created successfully (ID: ${graphSub.id}, expires: ${new Date(graphSub.expirationDateTime).toLocaleString()})`,
        };
    } catch (err) {
        console.error('Failed to create app subscription:', err);
        return {
            success: false,
            message: `Failed to create subscription: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

function buildEntraLink(): string {
    const appConfig = deps.getAppConfig();
    if (appConfig?.clientId) {
        return `https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/CallAnAPI/appId/${appConfig.clientId}/isMSAApp~/false`;
    }
    return 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/CallAnAPI';
}

export function renderAppCreateSubscriptionForm(): void {
    const container = document.getElementById('app-create-subscription-root');
    if (!container) return;

    render(
        h(CreateSubscriptionForm, {
            resourcePlaceholder: 'e.g. /users',
            disabled: formDisabled,
            onSubmit: doCreateAppSubscription,
            onResult: showAppResult,
            extraContent: h(
                'p',
                null,
                'To be able to create subscriptions with app permissions, the app registration must have appropriate permissions granted via the ',
                h('a', { href: buildEntraLink(), target: '_blank' }, 'Entra portal'),
                '.',
            ),
        }),
        container,
    );
}
