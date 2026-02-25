import express from 'express';
import cors from 'cors';
import path from 'path';
import session from 'express-session';
import fallback from 'express-history-api-fallback';
import http from 'http';
import { config } from './config';
import { webhookRouter } from './routes/webhook';
import { lifecycleWebhookRouter } from './routes/lifecycleWebhook';
import { subscriptionsRouter } from './routes/subscriptions';
import { notificationsRouter } from './routes/notifications';
import { configRouter } from './routes/appConfig';
import { initializeStorage } from './storage/tableStorage';
import { initWebSocketServer } from './wsServer';
import { requireApiToken } from './middleware/validateApiToken';

const ROOT = path.join(__dirname, '..', 'public');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
    session({
        secret: config.sessionSecret,
        resave: false,
        saveUninitialized: false,
    }),
);

// Serve static frontend files
app.use(express.static(ROOT));

// API routes
// Webhook endpoints are called by Microsoft Graph - no Bearer token expected
app.use('/api/webhook', webhookRouter);
app.use('/api/lifecycle', lifecycleWebhookRouter);
// Config endpoint is needed before the user is authenticated
app.use('/api/config', configRouter);
// All other API endpoints require a valid access token
app.use('/api/subscriptions', requireApiToken, subscriptionsRouter);
app.use('/api/notifications', requireApiToken, notificationsRouter);

// SPA fallback - serve index.html for all non-API routes
// FIXME provokes error
// app.get('*', (_req, res) => {
//     res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
// });
app.use(fallback('index.html', { root: ROOT }));

async function start() {
    await initializeStorage();
    const server = http.createServer(app);
    initWebSocketServer(server);
    server.listen(config.port, () => {
        console.log(`Server running at http://localhost:${config.port}`);
    });
}

start().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
