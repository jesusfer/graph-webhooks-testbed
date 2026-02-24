import { setupDetailsPageEventHandlers } from './detailsPage';
import {
    initCreateSubscription,
    setupCreateSubscriptionEventHandlers,
} from './createSubscription';
import {
    initSubscriptionsTable,
    loadSubscriptions,
    setupSubscriptionsTableEventHandlers,
} from './subscriptionsTable';
import { initWebSocket, connectWebSocket } from './websocket';
import {
    initNotificationsTable,
    loadNotifications,
    setupNotificationsTableEventHandlers,
} from './notificationsTable';
import {
    initAuth,
    initMsal,
    setupAuthEventHandlers,
    acquireTokenSilent,
    getAccessToken,
    getCurrentAccount,
    getUserId,
} from './auth';
import { AppConfig } from './types';

// -- State --

let appConfig: AppConfig | null = null;

// -- Bootstrap --

async function init(): Promise<void> {
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
}

// -- UI Setup --

function setupUI(): void {
    const loginSection = document.getElementById('login-section')!;
    const appSection = document.getElementById('app-section')!;
    const detailSection = document.getElementById('detail-section')!;
    const userName = document.getElementById('user-name')!;
    const btnLogin = document.getElementById('btn-login')!;
    const btnLogout = document.getElementById('btn-logout')!;

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

// -- Event Wiring --

document.addEventListener('DOMContentLoaded', () => {
    initAuth({ onAuthStateChanged: setupUI });
    setupAuthEventHandlers();

    initSubscriptionsTable({
        getUserId,
        getAccessToken,
        acquireTokenSilent,
    });
    setupSubscriptionsTableEventHandlers();

    initNotificationsTable({ getUserId });
    setupNotificationsTableEventHandlers();

    setupDetailsPageEventHandlers();

    initCreateSubscription({
        getAccessToken,
        acquireTokenSilent,
        getAppConfig: () => appConfig,
        getUserId,
        onSubscriptionCreated: loadSubscriptions,
    });
    setupCreateSubscriptionEventHandlers();

    initWebSocket({
        getUserId,
        onNewNotification: () => {
            loadNotifications();
            loadSubscriptions(); // also refresh to update lastNotificationAt
        },
    });

    init();
});
