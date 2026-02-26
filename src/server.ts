import cors from 'cors';
import express from 'express';
import fallback from 'express-history-api-fallback';
import { rateLimit } from 'express-rate-limit';
import session from 'express-session';
import http from 'http';
import path from 'path';
import { config } from './config';
import { requireApiToken } from './middleware/validateApiToken';
import { configRouter } from './routes/appConfig';
import { appSubscriptionsRouter } from './routes/appSubscriptions';
import { subscriptionsRouter } from './routes/delegatedSubscriptions';
import { lifecycleWebhookRouter } from './routes/lifecycleWebhook';
import { notificationsRouter } from './routes/notifications';
import { webhookRouter } from './routes/webhook';
import { initializeStorage } from './storage/tableStorage';
import { initWebSocketServer } from './wsServer';

const ROOT = path.join(__dirname, '..', 'public');

if (!config.entra.clientId || !config.entra.tenantId) {
    throw new Error('Entra app registration environment variables are required but not set.');
}

if (!config.graphNotificationUrl) {
    throw new Error('GRAPH_NOTIFICATION_URL is required to receive webhook notifications.');
}

if (!config.graphLifecycleNotificationUrl) {
    console.warn(
        'GRAPH_LIFECYCLE_NOTIFICATION_URL is not set. Lifecycle notifications will not be received.',
    );
}

if (!config.apiScope || !config.apiAudience) {
    throw new Error('API_SCOPE and API_AUDIENCE environment variables are required but not set.');
}

const app = express();

/* number of proxies between user and server */
app.set('trust proxy', config.trustProxy)

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
    session({
        secret: config.sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: true, // Set to true if using HTTPS
            httpOnly: true,
            sameSite: 'strict',
        },
    }),
);

const limiter = rateLimit({
	windowMs: config.rateLimitWindowMs,
	limit: config.rateLimitMax,
	standardHeaders: 'draft-8', // draft-6: `RateLimit-*` headers; draft-7 & draft-8: combined `RateLimit` header
})

// Apply the rate limiting middleware to all requests.
app.use(limiter)

// Serve static frontend files
app.use(
    express.static(ROOT, {
        setHeaders: (res, filePath, stat) => {
            if (!filePath.endsWith('redirect.html')) {
                res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
                res.setHeader('X-Content-Type-Options', 'nosniff');
                res.setHeader('X-Frame-Options', 'DENY');
            }
        },
    }),
);

// API routes
// Webhook endpoints are called by Microsoft Graph - no Bearer token expected
app.use('/api/webhook', webhookRouter);
app.use('/api/lifecycle', lifecycleWebhookRouter);
// Config endpoint is needed before the user is authenticated
app.use('/api/config', configRouter);
// All other API endpoints require a valid access token
app.use('/api/subscriptions', requireApiToken, subscriptionsRouter);
app.use('/api/app-subscriptions', requireApiToken, appSubscriptionsRouter);
app.use('/api/notifications', requireApiToken, notificationsRouter);

app.get('/ip', (request, response) => {
	response.send(request.ip);
});

// SPA fallback - serve index.html for all non-API routes
app.use(
    fallback('index.html', {
        root: ROOT,
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
        },
    }),
);

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
