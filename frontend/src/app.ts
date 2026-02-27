import { h, render } from 'preact';
import {
    loadAppNotifications,
    setupAppNotificationsTableEventHandlers,
} from './appNotifications/appNotificationsTable';
import {
    loadAppSubscriptions,
    setupAppSubscriptionsTableEventHandlers,
} from './appNotifications/appSubscriptionsTable';
import {
    initAppCreateSubscription,
    setupAppCreateSubscriptionEventHandlers,
} from './appNotifications/createSubscription';
import {
    getCurrentAccount,
    getUserId,
    initAuth,
    initMsal,
    setupAuthEventHandlers,
    signIn,
    signOut,
} from './auth';
import { Header } from './components/Header';
import {
    initCreateSubscription,
    setupCreateSubscriptionEventHandlers,
} from './delegatedNotifications/createSubscription';
import {
    initNotificationsTable,
    loadNotifications,
    setupNotificationsTableEventHandlers,
} from './delegatedNotifications/notificationsTable';
import {
    initSubscriptionsTable,
    loadSubscriptions,
    setupSubscriptionsTableEventHandlers,
} from './delegatedNotifications/subscriptionsTable';
import { setupDetailsPageEventHandlers, showNotificationDetail } from './detailsPage';
import { graphFetch } from './graph';
import { applyRoute, initRouter, navigate, Route } from './router';
import { AppConfig } from './types';
import { connectWebSocket, initWebSocket } from './websocket';

// -- State --

let appConfig: AppConfig | null = null;
let subscriptionRefreshInterval: ReturnType<typeof setInterval> | null = null;
let userAvatarUrl: string | null = null;

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

        // Set Entra portal link to the configured app registration
        const entraLink = document.getElementById('entra-portal-link') as HTMLAnchorElement | null;
        if (entraLink && appConfig.clientId) {
            entraLink.href = `https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/CallAnAPI/appId/${appConfig.clientId}/isMSAApp~/false`;
        }

        setupUI();
        connectWebSocket();
    } finally {
        const loader = document.getElementById('app-loading');
        if (loader) loader.hidden = true;
    }
}

// -- UI Setup --

function renderHeader(): void {
    const account = getCurrentAccount();
    const headerRoot = document.getElementById('header-root');
    if (!headerRoot) return;
    render(
        h(Header, {
            userName: account ? account.name || account.username : null,
            avatarUrl: userAvatarUrl,
            isSignedIn: !!account,
            onSignIn: signIn,
            onSignOut: signOut,
        }),
        headerRoot,
    );
}

function setupUI(): void {
    const loginSection = document.getElementById('login-section')!;

    stopSubscriptionRefreshCycle();
    userAvatarUrl = null;

    const account = getCurrentAccount();
    if (account) {
        loginSection.style.display = 'none';

        // Load user avatar from Graph
        loadUserAvatar();
        document.getElementById('btn-consent-scopes')!.hidden = false;
        loadSubscriptions();
        loadNotifications();
        loadAppSubscriptions();
        loadAppNotifications();
        startSubscriptionRefreshCycle();

        // Apply the current URL route now that we're authenticated
        applyRoute();
    } else {
        loginSection.style.display = 'block';
        document.getElementById('app-section')!.style.display = 'none';
        document.getElementById('detail-section')!.style.display = 'none';
        document.getElementById('btn-consent-scopes')!.hidden = true;
    }

    renderHeader();
}

/** Show the correct section based on the current route. */
function showRoute(match: { route: Route; notificationId?: string }): void {
    const appSection = document.getElementById('app-section')!;
    const detailSection = document.getElementById('detail-section')!;
    const delegatedSection = document.getElementById('delegated-section')!;
    const appSubsSection = document.getElementById('app-subscriptions-section')!;
    const toggleBtn = document.getElementById('btn-switch-section') as HTMLButtonElement;
    const title = document.getElementById('section-toggle-title')!;
    const consentBtn = document.getElementById('btn-consent-scopes') as HTMLButtonElement;

    // Don't do anything if user is not signed in
    if (!getCurrentAccount()) return;

    if (match.route === 'detail' && match.notificationId) {
        appSection.style.display = 'none';
        detailSection.style.display = 'block';
        showNotificationDetail(match.notificationId, getUserId);
        return;
    }

    // Show main app section
    appSection.style.display = 'block';
    detailSection.style.display = 'none';

    if (match.route === 'app') {
        delegatedSection.hidden = true;
        appSubsSection.hidden = false;
        toggleBtn.textContent = 'Switch to delegated subscriptions';
        title.textContent = 'App Subscriptions';
        consentBtn.hidden = true;
    } else {
        delegatedSection.hidden = false;
        appSubsSection.hidden = true;
        toggleBtn.textContent = 'Switch to app subscriptions';
        title.textContent = 'Delegated Subscriptions';
        consentBtn.hidden = !getUserId();
    }
}

async function loadUserAvatar(): Promise<void> {
    try {
        const response = await graphFetch('/v1.0/me/photo/$value');
        if (response.ok) {
            const blob = await response.blob();
            userAvatarUrl = URL.createObjectURL(blob);
            renderHeader();
        }
    } catch {
        // Silently ignore — avatar just stays hidden
    }
}

// -- Section Toggle --

function setupSectionToggle(): void {
    const btn = document.getElementById('btn-switch-section') as HTMLButtonElement;
    const delegatedSection = document.getElementById('delegated-section')!;

    btn.addEventListener('click', () => {
        const showingDelegated = !delegatedSection.hidden;
        navigate(showingDelegated ? '/app' : '/delegated');
    });
}

// -- Event Wiring --

document.addEventListener('DOMContentLoaded', () => {
    initRouter(showRoute);

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
