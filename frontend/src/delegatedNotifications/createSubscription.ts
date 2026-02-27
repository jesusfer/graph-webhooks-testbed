// -- Create Delegated Subscription --
// Handles delegated subscription creation functionality

import { apiFetch } from '../api';
import { graphFetch } from '../graph';
import { AppConfig } from '../types';

interface CreateSubscriptionDeps {
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
            showCreateResult(
                'GRAPH_ENCRYPTION_CERTIFICATE is not configured on the server. Set it in your .env file to enable rich notifications with resource data.',
                false,
            );
            return;
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
            showCreateResult(`Graph API error (${graphRes.status}): ${errBody}`, false);
            return;
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

        showCreateResult(
            `Subscription created successfully (ID: ${graphSub.id}, expires: ${new Date(graphSub.expirationDateTime).toLocaleString()})`,
            true,
        );
        resetCreateForm();
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

let autoHideTimer: ReturnType<typeof setTimeout> | null = null;

function showCreateResult(message: string, success: boolean): void {
    if (autoHideTimer) {
        clearTimeout(autoHideTimer);
        autoHideTimer = null;
    }

    const box = document.getElementById('create-result')!;
    box.className = `create-result ${success ? 'success' : 'error'}`;
    box.hidden = false;

    if (success) {
        autoHideTimer = setTimeout(() => {
            hideCreateResult();
            autoHideTimer = null;
        }, 60_000);
    }

    if (!success) {
        // Try to find and pretty-print a JSON object in the message
        const jsonMatch = message.match(/(\{[\s\S]*\})/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[1]);
                const prefix = message.substring(0, jsonMatch.index).trimEnd();
                const formatted = JSON.stringify(parsed, null, 2);
                box.innerHTML = '';
                if (prefix) {
                    box.appendChild(document.createTextNode(prefix + '\n'));
                }
                const pre = document.createElement('pre');
                pre.style.margin = '6px 0 0';
                pre.style.whiteSpace = 'pre-wrap';
                pre.style.fontSize = '0.82rem';
                pre.textContent = formatted;
                box.appendChild(pre);
                return;
            } catch {
                // Not valid JSON - fall through to plain text
            }
        }
    }

    box.textContent = message;
}

function hideCreateResult(): void {
    const box = document.getElementById('create-result');
    if (box) {
        box.hidden = true;
        box.textContent = '';
        box.className = 'create-result';
    }
}

function resetCreateForm(): void {
    const form = document.getElementById('create-subscription-form') as HTMLFormElement | null;
    if (form) form.reset();

    // Re-sync the change-type dropdown label after reset
    const menu = document.getElementById('changetype-menu');
    const toggle = document.getElementById('changetype-toggle');
    if (menu && toggle) {
        const checkboxes = menu.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
        const selected = Array.from(checkboxes)
            .filter((cb) => cb.checked)
            .map((cb) => cb.value);
        toggle.textContent = selected.length > 0 ? selected.join(', ') : 'Select change types';
    }
}

export function setupCreateSubscriptionEventHandlers(): void {
    // -- Change Type dropdown toggle --
    const toggle = document.getElementById('changetype-toggle')!;
    const menu = document.getElementById('changetype-menu')!;
    const dropdown = document.getElementById('changetype-dropdown')!;

    toggle.addEventListener('click', () => {
        const isOpen = !menu.hidden;
        menu.hidden = !isOpen ? false : true;
        menu.hidden = isOpen;
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target as Node)) {
            menu.hidden = true;
        }
    });

    // Update toggle label when checkboxes change
    const checkboxes = menu.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    const updateToggleLabel = () => {
        const selected = Array.from(checkboxes)
            .filter((cb) => cb.checked)
            .map((cb) => cb.value);
        toggle.textContent = selected.length > 0 ? selected.join(', ') : 'Select change types';
    };
    checkboxes.forEach((cb) => cb.addEventListener('change', updateToggleLabel));
    updateToggleLabel();

    // -- Delegated subscription form submit --
    document.getElementById('create-subscription-form')!.addEventListener('submit', (e) => {
        e.preventDefault();
        const resource = (document.getElementById('sub-resource') as HTMLInputElement).value.trim();
        const changeType = Array.from(
            document.querySelectorAll<HTMLInputElement>(
                '#changetype-menu input[type="checkbox"]:checked',
            ),
        )
            .map((cb) => cb.value)
            .join(',');
        if (!changeType) {
            showCreateResult('Please select at least one change type.', false);
            return;
        }
        const expMinutes =
            parseInt((document.getElementById('sub-expiration') as HTMLInputElement).value, 10) ||
            60;
        const includeResourceData = (
            document.getElementById('sub-includeResourceData') as HTMLInputElement
        ).checked;
        createSubscription(resource, changeType, expMinutes, includeResourceData);
    });
}
