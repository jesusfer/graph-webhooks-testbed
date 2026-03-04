import { h, render } from 'preact';
import { ConsentModal } from './components/ConsentModal';
import { Header } from './components/Header';
import { LoadingOverlay } from './components/LoadingOverlay';
import { NotificationDetail } from './components/NotificationDetail';
import { Section } from './components/Section';
import { SectionToggle } from './components/SectionToggle';
import { loadAppNotifications } from './pages/app/appNotificationsTable';
import { loadAppSubscriptions } from './pages/app/appSubscriptionsTable';
import {
    initAppCreateSubscription,
    renderAppCreateSubscriptionForm,
} from './pages/app/createSubscription';
import {
    initCreateSubscription,
    renderDelegatedCreateSubscriptionForm,
} from './pages/delegated/createSubscription';
import { initNotificationsTable, loadNotifications } from './pages/delegated/notificationsTable';
import { initSubscriptionsTable, loadSubscriptions } from './pages/delegated/subscriptionsTable';
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
import { connectWebSocket, disconnectWebSocket, initWebSocket } from './websocket';

// -- State --

let appConfig: AppConfig | null = null;
let userAvatarUrl: string | null = null;
let consentModalOpen = false;

// -- Bootstrap --

function renderLoadingOverlay(visible: boolean): void {
    const root = document.getElementById('app-loading-root');
    if (root) render(h(LoadingOverlay, { visible }), root);
}

async function init(): Promise<void> {
    renderLoadingOverlay(true);
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
    } finally {
        renderLoadingOverlay(false);
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

        connectWebSocket();

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
        disconnectWebSocket();
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

/**
 * Render both Section components, toggling visibility based on the active route.
 * Must be called before any child component renders into the section mount-points.
 */
function renderSections(activeRoute: 'delegated' | 'app'): void {
    const delegatedRoot = document.getElementById('delegated-section-root');
    if (delegatedRoot) {
        render(
            h(Section, {
                hidden: activeRoute !== 'delegated',
                rootIds: {
                    createSubscription: 'delegated-create-subscription-root',
                    result: 'delegated-result-root',
                    subscriptions: 'subscriptions-root',
                    notifications: 'notifications-root',
                },
            }),
            delegatedRoot,
        );
    }

    const appRoot = document.getElementById('app-section-root');
    if (appRoot) {
        render(
            h(Section, {
                hidden: activeRoute !== 'app',
                rootIds: {
                    createSubscription: 'app-create-subscription-root',
                    result: 'app-result-root',
                    subscriptions: 'app-subscriptions-root',
                    notifications: 'app-notifications-root',
                },
            }),
            appRoot,
        );
    }
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

    const activeRoute = match.route === 'app' ? 'app' : 'delegated';
    renderSections(activeRoute);
    renderSectionToggle(activeRoute);
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

    // Render sections early so mount-point divs exist before child renders
    renderSections('delegated');

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
