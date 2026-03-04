import { h, render } from 'preact';
import { loadAppNotifications } from './appNotifications/appNotificationsTable';
import { loadAppSubscriptions } from './appNotifications/appSubscriptionsTable';
import {
    initAppCreateSubscription,
    renderAppCreateSubscriptionForm,
} from './appNotifications/createSubscription';
import {
    getCurrentAccount,
    getUserId,
    initAuth,
    initMsal,
    setupAuthEventHandlers,
    signIn,
    signOut,
} from './services/auth';
import { Header } from './components/Header';
import {
    initCreateSubscription,
    renderDelegatedCreateSubscriptionForm,
} from './delegatedNotifications/createSubscription';
import {
    initNotificationsTable,
    loadNotifications,
} from './delegatedNotifications/notificationsTable';
import {
    initSubscriptionsTable,
    loadSubscriptions,
} from './delegatedNotifications/subscriptionsTable';
import { NotificationDetail } from './components/NotificationDetail';
import { callGraph } from './services/graph';
import { applyRoute, initRouter, navigate, Route } from './router';
import { AppConfig } from './types';
import { connectWebSocket, initWebSocket } from './websocket';

// -- State --

let appConfig: AppConfig | null = null;
let userAvatarUrl: string | null = null;

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
        render(
            h(NotificationDetail, {
                notificationId: match.notificationId,
                getUserId,
                onBack: (isApp: boolean) => {
                    navigate(isApp ? '/app' : '/delegated');
                },
            }),
            detailSection,
        );
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
        const response = await callGraph('/v1.0/me/photo/$value');
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

    initNotificationsTable({ getUserId });

    setupSectionToggle();

    initCreateSubscription({
        getAppConfig: () => appConfig,
        getUserId,
        onSubscriptionCreated: loadSubscriptions,
    });
    renderDelegatedCreateSubscriptionForm();

    initAppCreateSubscription({
        getAppConfig: () => appConfig,
        onAppSubscriptionCreated: loadAppSubscriptions,
    });
    renderAppCreateSubscriptionForm();

    initWebSocket({
        getUserId,
        onNewNotification: () => {
            loadNotifications();
            loadAppNotifications();
            loadSubscriptions(); // also refresh to update lastNotificationAt
            loadAppSubscriptions();
        },
    });

    init();
});
