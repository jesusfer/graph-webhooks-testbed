# Graph Webhooks Testbed

A web application for testing Microsoft Graph subscriptions and receiving webhook notifications.

## Features

- **MSAL Authentication** — Sign in with your Microsoft account using Entra ID Authorization Code flow with PKCE (`@azure/msal-browser`)
- **Create Graph Subscriptions** — Create subscriptions to Microsoft Graph resources (e.g. `me/messages`) directly from the UI
- **Webhook Receiver** — `POST /api/webhook` endpoint handles Graph validation handshakes and stores incoming notifications
- **Notifications Dashboard** — View all received webhook notifications with timestamps; click through to see the full pretty-printed JSON body
- **Azure Table Storage** — Subscriptions and notifications are persisted in Azure Storage Account tables

## Prerequisites

- Node.js 18+
- An **Azure Storage Account** (or [Azurite](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite) for local dev)
- An **Entra ID App Registration** with:
  - Single-page application (SPA) redirect URI (e.g. `http://localhost:3000`)
  - API permissions: `User.Read`, `Mail.Read` (or whatever resources you want to subscribe to)
  - Expose an API: at least one scope to use for the backend API
- It's recommended to have **two** app registrations, one for the client and one for the API. For this setup, the API app registration will only Expose an API with one scope and the client app will have the SPA redirect URI, Graph API permissions and backend API permissions. If the client app is preauthorized to use the backend app, users will not see a consent prompt.
- A **publicly reachable URL** for the webhook endpoint (use [ngrok](https://ngrok.com/) or [VS Code port forwarding](https://code.visualstudio.com/docs/editor/port-forwarding) for local dev)

## Setup

1. **Install dependencies**

    ```bash
    npm install
    ```

2. **Configure environment** — Copy `.env.example` to `.env` and fill in your values:

    ```bash
    cp .env.example .env
    ```

    | Variable                          | Description                                                                       |
    | --------------------------------- | ---------------------------------------------------------------------------       |
    | `ENTRA_CLIENT_ID`                 | Entra ID app registration client ID                                               |
    | `ENTRA_TENANT_ID`                 | Entra ID tenant ID                                                                |
    | `ENTRA_REDIRECT_URI`              | SPA redirect URI (e.g. `http://localhost:3000`)                                   |
    | `AZURE_STORAGE_CONNECTION_STRING` | Azure Storage connection string                                                   |
    | `GRAPH_NOTIFICATION_URL`          | Public URL for webhook endpoint (e.g. `https://xxxx.ngrok.io/api/webhook`)        |
    | `GRAPH_ENCRYPTION_CERTIFICATE`    | Base64-encoded X.509 certificate for rich notifications (optional)                |
    | `GRAPH_ENCRYPTION_CERTIFICATE_ID` | Identifier for the encryption certificate (optional)                              |
    | `GRAPH_ENCRYPTION_PFX`            | Base64-encoded PFX (PKCS#12) with private key for decrypting payloads (optional)  |
    | `GRAPH_ENCRYPTION_PFX_PASSWORD`   | Password for the PFX file, leave empty if none (optional)                         |
    | `API_AUDIENCE`                    | App ID URI used as the token audience (e.g. `api://<client-id>`)                  |
    | `API_SCOPE`                       | Full scope URI the frontend requests (e.g. `api://<client-id>/user_access`)       |
    | `SESSION_SECRET`                  | Random secret for Express sessions                                                |
    | `PORT`                            | Server port (default: `3000`)                                                     |
    | `TRUST_PROXY`                     | Number of reverse proxies between client and server (default: `1`)                |
    | `RATE_LIMIT_WINDOW_MS`            | Rate limit window in milliseconds (default: `900000` / 15 min)                    |
    | `RATE_LIMIT_MAX`                  | Max requests per IP per window (default: `100`)                                   |

3. **Build**

    ```bash
    npm run build:all
    ```

4. **Start**

    ```bash
    npm start
    ```

## Development

Run the backend and frontend watchers in parallel:

```bash
npm run dev:watch
```

Or run the backend with ts-node:

```bash
npm run dev
```

## Project Structure

```
src/
  backend/
    config.ts              — Environment config and app settings
    server.ts              — Express server entry point
    wsServer.ts            — WebSocket server for real-time broadcasting
    @types/                — Custom type declarations
    middleware/            — Express middleware (token validation)
    storage/               — Azure Table Storage helpers
    routes/                — API route handlers (webhook, subscriptions, etc.)
    util/                  — Utilities (decryption, Graph client, validation)
  frontend/
    api.ts                 — Fetch wrapper for backend API calls
    app.ts                 — Frontend entry point (auth state, auto-refresh)
    auth.ts                — MSAL authentication and token acquisition
    detailsPage.ts         — Notification detail view with JSON pretty-printing
    graph.ts               — Fetch wrapper for Microsoft Graph API calls
    router.ts              — Client-side routing
    types.ts               — Shared TypeScript interfaces
    websocket.ts           — Client-side WebSocket with auto-reconnect
    appNotifications/      — App-only notification and subscription UI
    delegatedNotifications/ — Delegated notification and subscription UI
public/
  index.html               — Single-page application shell
  redirect.html            - MSAL redirection page with bridge
  js/app.js                — Bundled frontend (generated)
```

## How It Works

1. User signs in via MSAL popup (Authorization Code + PKCE)
2. User fills in a Graph resource and change type, clicks **Create Subscription**
3. The frontend calls Microsoft Graph `POST /v1.0/subscriptions` with the user's access token
4. Graph validates the webhook endpoint by sending a `validationToken` query parameter
5. The backend responds with the token, completing the handshake
6. When events occur, Graph sends notifications to `POST /api/webhook`
7. The backend stores each notification in Azure Table Storage
8. The dashboard shows all subscriptions and notifications for the signed-in user

## Libraries quirks

### MSAL bridge

Copy msal-redirect-bridge to lib for development.

```shell
cp 'frontend/node_modules/@azure/msal-browser/lib/redirect-bridge/msal-redirect-bridge.js' frontend/public/lib/
```


## Architecture Diagram

```
       ┌── Microsoft Graph ──┐
       │                     │
       ▼                     ▼
┌──────────────┐     ┌───────────────┐
│ POST /webhook│     │POST /lifecycle│
│  (no auth)   │     │  (no auth)    │
└──────┬───────┘     └──────┬────────┘
       │                     │
       ▼                     ▼
  findUserForSubscription()
  validateNotificationTokens()
  decryptNotificationContent()
  insertNotification()
  broadcast() ──────────────────► WebSocket clients
       │
       ▼
 Azure Table Storage
  ┌─────────────┐  ┌──────────────┐
  │Subscriptions│  │Notifications │
  └─────────────┘  └──────────────┘
       ▲
       │
  requireApiToken() ◄── Bearer token
       │
       ▼
 /api/subscriptions
 /api/app-subscriptions
 /api/notifications
```

## Security Considerations

1. Webhook endpoints are unauthenticated (as required by Graph) but validate incoming data via validationTokens JWT checks and clientState matching.
1. API endpoints require Entra ID Bearer tokens validated against JWKS.
1. Input validation uses strict regex patterns via validateParams.ts to prevent injection.
1. HTML escaping via escapeHtml prevents XSS when echoing validation tokens.
1. Rate limiting is applied globally via express-rate-limit.
1. Tenant verification on both webhook and lifecycle handlers ensures only notifications from the configured tenant are processed