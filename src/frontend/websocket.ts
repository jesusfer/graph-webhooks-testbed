// -- WebSocket --
// Handles real-time notification updates via WebSocket

interface WebSocketDeps {
    getUserId: () => string;
    onNewNotification: () => void;
}

let ws: WebSocket | null = null;
let deps: WebSocketDeps;

export function initWebSocket(dependencies: WebSocketDeps): void {
    deps = dependencies;
}

export function connectWebSocket(): void {
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
                // Only refresh if the notification belongs to the current user
                if (msg.payload?.userId === deps.getUserId()) {
                    deps.onNewNotification();
                }
            }
        } catch {
            // ignore malformed messages
        }
    });

    ws.addEventListener('close', () => {
        console.log('WebSocket disconnected, reconnecting in 5s...');
        setTimeout(connectWebSocket, 5000);
    });

    ws.addEventListener('error', () => {
        ws?.close();
    });
}
