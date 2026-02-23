// -- Create Subscription --
// Handles subscription creation functionality

interface AppConfig {
    clientId: string;
    tenantId: string;
    redirectUri: string;
    graphNotificationUrl: string;
    hasEncryptionCertificate: boolean;
    encryptionCertificate: string;
}

interface CreateSubscriptionDeps {
    getAccessToken: () => string;
    acquireTokenSilent: () => Promise<string>;
    getAppConfig: () => AppConfig | null;
    getUserId: () => string;
    onSubscriptionCreated: () => void;
}

let deps: CreateSubscriptionDeps;

export function initCreateSubscription(dependencies: CreateSubscriptionDeps): void {
    deps = dependencies;
}

export async function createSubscription(
    resource: string,
    changeType: string,
    expirationMinutes: number,
    includeResourceData: boolean = false,
): Promise<void> {
    hideCreateResult();
    setCreateFormBusy(true);

    try {
        await doCreateSubscription(resource, changeType, expirationMinutes, includeResourceData);
    } finally {
        setCreateFormBusy(false);
    }
}

async function doCreateSubscription(
    resource: string,
    changeType: string,
    expirationMinutes: number,
    includeResourceData: boolean,
): Promise<void> {
    let accessToken = deps.getAccessToken();
    if (!accessToken) {
        accessToken = await deps.acquireTokenSilent();
        if (!accessToken) {
            showCreateResult('Could not acquire access token. Please sign in again.', false);
            return;
        }
    }

    const expirationDateTime = new Date(Date.now() + expirationMinutes * 60 * 1000).toISOString();

    const appConfig = deps.getAppConfig();
    const notificationUrl = appConfig?.graphNotificationUrl || '';
    if (!notificationUrl) {
        showCreateResult(
            'GRAPH_NOTIFICATION_URL is not configured on the server. Set it in your .env file to the public URL of your /api/webhook endpoint.',
            false,
        );
        return;
    }

    // Call Microsoft Graph to create the subscription
    const graphPayload: Record<string, unknown> = {
        changeType,
        notificationUrl,
        resource,
        expirationDateTime,
    };

    if (includeResourceData) {
        if (!appConfig?.hasEncryptionCertificate) {
            showCreateResult(
                'GRAPH_ENCRYPTION_CERTIFICATE is not configured on the server. Set it in your .env file to enable rich notifications with resource data.',
                false,
            );
            return;
        }
        graphPayload.includeResourceData = true;
        graphPayload.encryptionCertificate = appConfig.encryptionCertificate;
        graphPayload.encryptionCertificateId = 'graphWebhooksTestbed';
    }

    try {
        const graphRes = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(graphPayload),
        });

        if (!graphRes.ok) {
            const errBody = await graphRes.text();
            showCreateResult(`Graph API error (${graphRes.status}): ${errBody}`, false);
            return;
        }

        const graphSub = await graphRes.json();

        // Store in our backend database
        await fetch('/api/subscriptions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: deps.getUserId(),
                subscriptionId: graphSub.id,
                resource: graphSub.resource,
                changeType: graphSub.changeType,
                expirationDateTime: graphSub.expirationDateTime,
                notificationUrl: graphSub.notificationUrl,
                ...(includeResourceData ? { includeResourceData: true } : {}),
            }),
        });

        showCreateResult(
            `Subscription created successfully (ID: ${graphSub.id}, expires: ${new Date(graphSub.expirationDateTime).toLocaleString()})`,
            true,
        );
        deps.onSubscriptionCreated();
    } catch (err) {
        console.error('Failed to create subscription:', err);
        showCreateResult(
            `Failed to create subscription: ${err instanceof Error ? err.message : String(err)}`,
            false,
        );
    }
}

// -- Create-form busy state --

function setCreateFormBusy(busy: boolean): void {
    const fieldset = document.getElementById('create-sub-fieldset') as HTMLFieldSetElement | null;
    const spinner = document.querySelector('#btn-create-sub .spinner') as HTMLElement | null;
    const btnText = document.getElementById('btn-create-sub-text');
    if (fieldset) fieldset.disabled = busy;
    if (spinner) spinner.hidden = !busy;
    if (btnText) btnText.textContent = busy ? 'Creating...' : 'Create Subscription';
}

// -- Create-result feedback box --

function showCreateResult(message: string, success: boolean): void {
    const box = document.getElementById('create-result')!;
    box.textContent = message;
    box.className = `create-result ${success ? 'success' : 'error'}`;
    box.hidden = false;
}

function hideCreateResult(): void {
    const box = document.getElementById('create-result');
    if (box) {
        box.hidden = true;
        box.textContent = '';
        box.className = 'create-result';
    }
}

export function setupCreateSubscriptionEventHandlers(): void {
    document.getElementById('create-subscription-form')!.addEventListener('submit', (e) => {
        e.preventDefault();
        const resource = (document.getElementById('sub-resource') as HTMLInputElement).value.trim();
        const changeType = (document.getElementById('sub-changeType') as HTMLSelectElement).value;
        const expMinutes =
            parseInt((document.getElementById('sub-expiration') as HTMLInputElement).value, 10) ||
            60;
        const includeResourceData = (
            document.getElementById('sub-includeResourceData') as HTMLInputElement
        ).checked;
        createSubscription(resource, changeType, expMinutes, includeResourceData);
    });
}
