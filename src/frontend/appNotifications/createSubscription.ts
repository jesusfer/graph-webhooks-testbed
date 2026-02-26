// -- Create App Subscription --
// Handles app-only subscription creation functionality

import { apiFetch } from '../apiFetch';

interface CreateAppSubscriptionDeps {
    onAppSubscriptionCreated?: () => void;
}

let deps: CreateAppSubscriptionDeps;

export function initAppCreateSubscription(dependencies: CreateAppSubscriptionDeps): void {
    deps = dependencies;
}

async function createAppSubscription(
    resource: string,
    changeType: string,
    expirationMinutes: number,
    includeResourceData: boolean,
): Promise<void> {
    hideAppCreateResult();
    setAppCreateFormBusy(true);

    try {
        const res = await apiFetch('/api/app-subscriptions', {
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
            showAppCreateResult(`Error (${res.status}): ${errBody}`, false);
            return;
        }

        const graphSub = await res.json();
        showAppCreateResult(
            `Subscription created successfully (ID: ${graphSub.id}, expires: ${new Date(graphSub.expirationDateTime).toLocaleString()})`,
            true,
        );
        resetAppCreateForm();
        deps.onAppSubscriptionCreated?.();
    } catch (err) {
        console.error('Failed to create app subscription:', err);
        showAppCreateResult(
            `Failed to create subscription: ${err instanceof Error ? err.message : String(err)}`,
            false,
        );
    } finally {
        setAppCreateFormBusy(false);
    }
}

function setAppCreateFormBusy(busy: boolean): void {
    const fieldset = document.getElementById(
        'create-app-sub-fieldset',
    ) as HTMLFieldSetElement | null;
    const spinner = document.querySelector('#btn-create-app-sub .spinner') as HTMLElement | null;
    const btnText = document.getElementById('btn-create-app-sub-text');
    if (fieldset) fieldset.disabled = busy;
    if (spinner) spinner.hidden = !busy;
    if (btnText) btnText.textContent = busy ? 'Creating...' : 'Create Subscription';
}

let appAutoHideTimer: ReturnType<typeof setTimeout> | null = null;

function showAppCreateResult(message: string, success: boolean): void {
    if (appAutoHideTimer) {
        clearTimeout(appAutoHideTimer);
        appAutoHideTimer = null;
    }

    const box = document.getElementById('create-app-result')!;
    box.className = `create-result ${success ? 'success' : 'error'}`;
    box.hidden = false;

    if (success) {
        appAutoHideTimer = setTimeout(() => {
            hideAppCreateResult();
            appAutoHideTimer = null;
        }, 60_000);
    }

    if (!success) {
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

function hideAppCreateResult(): void {
    const box = document.getElementById('create-app-result');
    if (box) {
        box.hidden = true;
        box.textContent = '';
        box.className = 'create-result';
    }
}

function resetAppCreateForm(): void {
    const form = document.getElementById(
        'create-app-subscription-form',
    ) as HTMLFormElement | null;
    if (form) form.reset();

    const menu = document.getElementById('app-changetype-menu');
    const toggle = document.getElementById('app-changetype-toggle');
    if (menu && toggle) {
        const checkboxes = menu.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
        const selected = Array.from(checkboxes)
            .filter((cb) => cb.checked)
            .map((cb) => cb.value);
        toggle.textContent = selected.length > 0 ? selected.join(', ') : 'Select change types';
    }
}

export function setupAppCreateSubscriptionEventHandlers(): void {
    // -- App Change Type dropdown toggle --
    const appToggle = document.getElementById('app-changetype-toggle')!;
    const appMenu = document.getElementById('app-changetype-menu')!;
    const appDropdown = document.getElementById('app-changetype-dropdown')!;

    appToggle.addEventListener('click', () => {
        appMenu.hidden = !appMenu.hidden;
    });

    document.addEventListener('click', (e) => {
        if (!appDropdown.contains(e.target as Node)) {
            appMenu.hidden = true;
        }
    });

    const appCheckboxes = appMenu.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    const updateAppToggleLabel = () => {
        const selected = Array.from(appCheckboxes)
            .filter((cb) => cb.checked)
            .map((cb) => cb.value);
        appToggle.textContent =
            selected.length > 0 ? selected.join(', ') : 'Select change types';
    };
    appCheckboxes.forEach((cb) => cb.addEventListener('change', updateAppToggleLabel));
    updateAppToggleLabel();

    // -- App subscription form submit --
    document.getElementById('create-app-subscription-form')!.addEventListener('submit', (e) => {
        e.preventDefault();
        const resource = (
            document.getElementById('app-sub-resource') as HTMLInputElement
        ).value.trim();
        const changeType = Array.from(
            document.querySelectorAll<HTMLInputElement>(
                '#app-changetype-menu input[type="checkbox"]:checked',
            ),
        )
            .map((cb) => cb.value)
            .join(',');
        if (!changeType) {
            showAppCreateResult('Please select at least one change type.', false);
            return;
        }
        const expMinutes =
            parseInt(
                (document.getElementById('app-sub-expiration') as HTMLInputElement).value,
                10,
            ) || 60;
        const includeResourceData = (
            document.getElementById('app-sub-includeResourceData') as HTMLInputElement
        ).checked;
        createAppSubscription(resource, changeType, expMinutes, includeResourceData);
    });
}
