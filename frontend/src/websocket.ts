// -- WebSocket --
// Handles real-time notification updates via WebSocket

interface WebSocketDeps {
    getUserId: () => string;
    onNewNotification: () => void;
}

let ws: WebSocket | null = null;
let deps: WebSocketDeps;
let shouldReconnect = false;

export function initWebSocket(dependencies: WebSocketDeps): void {
    deps = dependencies;
}

export function connectWebSocket(): void {
    // Close any existing connection before opening a new one
    if (ws) {
        shouldReconnect = false;
        ws.close();
    }

    shouldReconnect = true;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.addEventListener('open', () => {
        console.log('WebSocket connected');
    });

    ws.addEventListener('message', (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'new-notification') {
                // Refresh if the notification belongs to the current user or to app subscriptions
                const notifUserId = msg.payload?.userId;
                if (notifUserId === deps.getUserId() || notifUserId === '__app__') {
                    deps.onNewNotification();
                }
            }
        } catch {
            // ignore malformed messages
        }
    });

    ws.addEventListener('close', () => {
        if (shouldReconnect) {
            console.log('WebSocket disconnected, reconnecting in 5s...');
            setTimeout(connectWebSocket, 5000);
        } else {
            console.log('WebSocket disconnected');
        }
    });

    ws.addEventListener('error', () => {
        ws?.close();
    });
}

export function disconnectWebSocket(): void {
    shouldReconnect = false;
    if (ws) {
        ws.close();
        ws = null;
    }
}
