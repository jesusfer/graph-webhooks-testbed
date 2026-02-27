import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';

let wss: WebSocketServer;

/**
 * Initialize the WebSocket server, attaching it to the existing HTTP server.
 */
export function initWebSocketServer(server: http.Server): void {
    wss = new WebSocketServer({
        server,
        path: '/ws',
    });

    wss.on('connection', (ws) => {
        console.log('WebSocket client connected');

        ws.on('close', () => {
            console.log('WebSocket client disconnected');
        });
    });

    console.log('WebSocket server initialized on /ws');
}

/**
 * Broadcast a message to all connected WebSocket clients.
 */
export function broadcast(type: string, payload: Record<string, unknown>): void {
    if (!wss) return;

    const message = JSON.stringify({ type, payload });

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}
