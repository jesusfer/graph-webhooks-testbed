import { setupDetailsPageEventHandlers } from './detailsPage';
import {
    initCreateSubscription,
    setupCreateSubscriptionEventHandlers,
} from './delegatedNotifications/createSubscription';
import {
    initAppCreateSubscription,
    setupAppCreateSubscriptionEventHandlers,
} from './appNotifications/createSubscription';
import {
    initSubscriptionsTable,
    loadSubscriptions,
    setupSubscriptionsTableEventHandlers,
} from './delegatedNotifications/subscriptionsTable';
import { initWebSocket, connectWebSocket } from './websocket';
import {
    initNotificationsTable,
    loadNotifications,
    setupNotificationsTableEventHandlers,
} from './delegatedNotifications/notificationsTable';
import { initAuth, initMsal, setupAuthEventHandlers, getCurrentAccount, getUserId } from './auth';
import {
    loadAppSubscriptions,
    setupAppSubscriptionsTableEventHandlers,
} from './appNotifications/appSubscriptionsTable';
import {
    loadAppNotifications,
    setupAppNotificationsTableEventHandlers,
} from './appNotifications/appNotificationsTable';
import { AppConfig } from './types';

// -- State --

let appConfig: AppConfig | null = null;
let subscriptionRefreshInterval: ReturnType<typeof setInterval> | null = null;

const REFRESH_INTERVAL_MS = 60_000;

/** Restart the CSS animation on the spinner so it's in sync with the interval. */
function resetRefreshSpinner(): void {
    const spinner = document.getElementById('subs-refresh-spinner') as HTMLElement | null;
    if (!spinner) return;
    spinner.style.animationName = 'none';
    // Force reflow so the browser picks up the reset
    void spinner.offsetHeight;
    spinner.style.animationName = '';
}

/** (Re)start the 60-second auto-refresh cycle and synchronise the spinner. */
function startSubscriptionRefreshCycle(): void {
    if (subscriptionRefreshInterval) {
        clearInterval(subscriptionRefreshInterval);
    }
    const spinner = document.getElementById('subs-refresh-spinner');
    if (spinner) spinner.hidden = false;
    resetRefreshSpinner();
    subscriptionRefreshInterval = setInterval(() => {
        loadSubscriptions();
        resetRefreshSpinner();
    }, REFRESH_INTERVAL_MS);
}

function stopSubscriptionRefreshCycle(): void {
    if (subscriptionRefreshInterval) {
        clearInterval(subscriptionRefreshInterval);
        subscriptionRefreshInterval = null;
    }
    const spinner = document.getElementById('subs-refresh-spinner');
    if (spinner) spinner.hidden = true;
}

// -- Bootstrap --

async function init(): Promise<void> {
    try {
        // Fetch server-side config
        const res = await fetch('/api/config');
        appConfig = await res.json();

        if (!appConfig) {
            console.warn('App config missing - app will not initialize.');
            return;
        }

        await initMsal(appConfig);

        setupUI();
        connectWebSocket();
    } finally {
        const loader = document.getElementById('app-loading');
        if (loader) loader.hidden = true;
    }
}

// -- UI Setup --

function setupUI(): void {
    const loginSection = document.getElementById('login-section')!;
    const appSection = document.getElementById('app-section')!;
    const detailSection = document.getElementById('detail-section')!;
    const userName = document.getElementById('user-name')!;
    const btnLogin = document.getElementById('btn-login')!;
    const btnLogout = document.getElementById('btn-logout')!;

    stopSubscriptionRefreshCycle();

    const account = getCurrentAccount();
    if (account) {
        loginSection.style.display = 'none';
        appSection.style.display = 'block';
        detailSection.style.display = 'none';
        userName.textContent = account.name || account.username;
        btnLogin.hidden = true;
        btnLogout.hidden = false;
        document.getElementById('btn-consent-scopes')!.hidden = false;
        loadSubscriptions();
        loadNotifications();
        loadAppSubscriptions();
        loadAppNotifications();
        startSubscriptionRefreshCycle();
    } else {
        loginSection.style.display = 'block';
        appSection.style.display = 'none';
        detailSection.style.display = 'none';
        userName.textContent = '';
        btnLogin.hidden = false;
        btnLogout.hidden = true;
        document.getElementById('btn-consent-scopes')!.hidden = true;
    }
}

// -- Section Toggle --

function setupSectionToggle(): void {
    const btn = document.getElementById('btn-switch-section') as HTMLButtonElement;
    const title = document.getElementById('section-toggle-title')!;
    const delegatedSection = document.getElementById('delegated-section')!;
    const appSubsSection = document.getElementById('app-subscriptions-section')!;

    btn.addEventListener('click', () => {
        const showingDelegated = !delegatedSection.hidden;
        delegatedSection.hidden = showingDelegated;
        appSubsSection.hidden = !showingDelegated;
        btn.textContent = showingDelegated
            ? 'Switch to delegated subscriptions'
            : 'Switch to app subscriptions';
        title.textContent = showingDelegated ? 'App Subscriptions' : 'Delegated Subscriptions';
    });
}

// -- Event Wiring --

document.addEventListener('DOMContentLoaded', () => {
    initAuth({ onAuthStateChanged: setupUI });
    setupAuthEventHandlers();

    initSubscriptionsTable({
        getUserId,
    });
    setupSubscriptionsTableEventHandlers(startSubscriptionRefreshCycle);

    initNotificationsTable({ getUserId });
    setupNotificationsTableEventHandlers();

    setupDetailsPageEventHandlers();
    setupSectionToggle();
    setupAppSubscriptionsTableEventHandlers();
    setupAppNotificationsTableEventHandlers();

    initCreateSubscription({
        getAppConfig: () => appConfig,
        getUserId,
        onSubscriptionCreated: loadSubscriptions,
    });
    setupCreateSubscriptionEventHandlers();

    initAppCreateSubscription({
        onAppSubscriptionCreated: loadAppSubscriptions,
    });
    setupAppCreateSubscriptionEventHandlers();

    initWebSocket({
        getUserId,
        onNewNotification: () => {
            loadNotifications();
            loadAppNotifications();
            loadSubscriptions(); // also refresh to update lastNotificationAt
            loadAppSubscriptions();
            startSubscriptionRefreshCycle(); // reset the 60s cycle after a notification-triggered refresh
        },
    });

    init();
});
