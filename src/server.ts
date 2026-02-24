import express from 'express';
import cors from 'cors';
import path from 'path';
import session from 'express-session';
import http from 'http';
import { config } from './config';
import { webhookRouter } from './routes/webhook';
import { lifecycleWebhookRouter } from './routes/lifecycleWebhook';
import { subscriptionsRouter } from './routes/subscriptions';
import { notificationsRouter } from './routes/notifications';
import { configRouter } from './routes/appConfig';
import { initializeStorage } from './storage/tableStorage';
import { initWebSocketServer } from './wsServer';

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
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api/webhook', webhookRouter);
app.use('/api/lifecycle', lifecycleWebhookRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/config', configRouter);

// SPA fallback – serve index.html for all non-API routes
app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

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
