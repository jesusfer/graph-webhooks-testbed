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

    | Variable                          | Description                                                                |
    | --------------------------------- | -------------------------------------------------------------------------- |
    | `ENTRA_CLIENT_ID`                 | Entra ID app registration client ID                                        |
    | `ENTRA_TENANT_ID`                 | Entra ID tenant ID                                                         |
    | `ENTRA_REDIRECT_URI`              | SPA redirect URI (e.g. `http://localhost:3000`)                            |
    | `AZURE_STORAGE_CONNECTION_STRING` | Azure Storage connection string                                            |
    | `GRAPH_NOTIFICATION_URL`          | Public URL for webhook endpoint (e.g. `https://xxxx.ngrok.io/api/webhook`) |
    | `GRAPH_ENCRYPTION_CERTIFICATE`    | Base64-encoded X.509 certificate for rich notifications (optional)         |
    | `GRAPH_ENCRYPTION_CERTIFICATE_ID` | Identifier for the encryption certificate (optional)                       |
    | `GRAPH_ENCRYPTION_PFX`            | Base64-encoded PFX (PKCS#12) with private key for decrypting payloads (optional) |
    | `GRAPH_ENCRYPTION_PFX_PASSWORD`   | Password for the PFX file, leave empty if none (optional)                  |
    | `SESSION_SECRET`                  | Random secret for Express sessions                                         |
    | `PORT`                            | Server port (default: `3000`)                                              |

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

```bash
src/
  config.ts              — Environment config
  server.ts              — Express server entry point
  routes/
    appConfig.ts         — GET /api/config (public MSAL config)
    webhook.ts           — POST /api/webhook (Graph notification receiver)
    subscriptions.ts     — CRUD for subscription records
    notifications.ts     — Read notification records
  storage/
    tableStorage.ts      — Azure Table Storage helpers
  frontend/
    app.ts               — Frontend SPA (bundled with esbuild)
public/
  index.html             — Single-page application shell
  js/app.js              — Bundled frontend (generated)
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
