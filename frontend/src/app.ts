import { h, render } from 'preact';
import { loadAppNotifications } from './appNotifications/appNotificationsTable';
import { loadAppSubscriptions } from './appNotifications/appSubscriptionsTable';
import {
    initAppCreateSubscription,
    renderAppCreateSubscriptionForm,
} from './appNotifications/createSubscription';
import { ConsentModal } from './components/ConsentModal';
import { Header } from './components/Header';
import { NotificationDetail } from './components/NotificationDetail';
import { SectionToggle } from './components/SectionToggle';
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
import { applyRoute, initRouter, navigate, Route } from './router';
import {
    consentToScopes,
    getAllGraphScopes,
    getCurrentAccount,
    getUserId,
    initAuth,
    initMsal,
    setupAuthEventHandlers,
    signIn,
    signOut,
} from './services/auth';
import { callGraph } from './services/graph';
import { AppConfig } from './types';
import { connectWebSocket, initWebSocket } from './websocket';

// -- State --

let appConfig: AppConfig | null = null;
let userAvatarUrl: string | null = null;
let consentModalOpen = false;

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
    }

    renderHeader();
    renderConsentModal();
}

function openConsentModal(): void {
    consentModalOpen = true;
    renderConsentModal();
}

function closeConsentModal(): void {
    consentModalOpen = false;
    renderConsentModal();
}

function renderConsentModal(): void {
    const root = document.getElementById('consent-modal-root');
    if (!root) return;
    render(
        h(ConsentModal, {
            open: consentModalOpen,
            onClose: closeConsentModal,
            getCurrentScopes: getAllGraphScopes,
            onConsent: consentToScopes,
        }),
        root,
    );
}

function renderSectionToggle(route: 'delegated' | 'app'): void {
    const root = document.getElementById('section-toggle-root');
    if (!root) return;

    const isDelegated = route === 'delegated';
    render(
        h(SectionToggle, {
            title: isDelegated ? 'Delegated Subscriptions' : 'App Subscriptions',
            switchLabel: isDelegated
                ? 'Switch to app subscriptions'
                : 'Switch to delegated subscriptions',
            showConsentButton: isDelegated && !!getUserId(),
            onConsentScopes: openConsentModal,
            onSwitch: () => navigate(isDelegated ? '/app' : '/delegated'),
        }),
        root,
    );
}

/** Show the correct section based on the current route. */
function showRoute(match: { route: Route; notificationId?: string }): void {
    const appSection = document.getElementById('app-section')!;
    const detailSection = document.getElementById('detail-section')!;
    const delegatedSection = document.getElementById('delegated-section')!;
    const appSubsSection = document.getElementById('app-subscriptions-section')!;

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
    } else {
        delegatedSection.hidden = false;
        appSubsSection.hidden = true;
    }

    renderSectionToggle(match.route === 'app' ? 'app' : 'delegated');
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

// -- Event Wiring --

document.addEventListener('DOMContentLoaded', () => {
    initRouter(showRoute);

    initAuth({ onAuthStateChanged: setupUI });
    setupAuthEventHandlers();

    initSubscriptionsTable({
        getUserId,
    });

    initNotificationsTable({ getUserId });

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
