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
    | `AZURE_STORAGE_CONNECTION_STRING` | Azure Storage connection string (for key-based auth)                              |
    | `AZURE_STORAGE_ACCOUNT_NAME`      | Storage account name used with managed identity authentication                     |
    | `AZURE_STORAGE_USE_MANAGED_IDENTITY` | Set to `true` to use a managed identity instead of the storage key             |
    | `AZURE_STORAGE_TABLE_ENDPOINT`    | Optional HTTPS Table endpoint override for private/custom networking              |
    | `AZURE_CLIENT_ID`                 | Optional client ID for a user-assigned managed identity                           |
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

### Managed identity permissions for Azure Storage

When `AZURE_STORAGE_USE_MANAGED_IDENTITY=true`, assign the web app's managed identity the
**Storage Table Data Contributor** role on the storage account. This role provides the
table data-plane permissions the application needs to create the `Subscriptions` and
`Notifications` tables and to read, insert, update, and delete their entities.

- For a **system-assigned managed identity**, assign the role to the enterprise
  application/service principal created for the web app.
- For a **user-assigned managed identity**, assign the role to that user-assigned
  identity and set `AZURE_CLIENT_ID` to its client ID.
- Use the storage account as the role-assignment scope so the application can create
  both tables. If the tables are provisioned separately, the role can instead be
  assigned to each table at table scope.
- If Storage public network access is disabled, ensure the App Service can reach the
  Table private endpoint through VNet integration and private DNS. Leave
  `AZURE_STORAGE_TABLE_ENDPOINT` empty when private DNS makes the normal account
  hostname resolve to the private endpoint; set it to an HTTPS Table endpoint only
  when your private/custom networking requires an override.
- Management-plane roles such as **Contributor** or **Storage Account Contributor**
  do not by themselves grant access to table data.

In the Azure portal, open the storage account, select **Access control (IAM)** >
**Add role assignment**, select **Storage Table Data Contributor**, and choose the
web app's system-assigned or user-assigned managed identity.

The equivalent Azure CLI assignment at storage-account scope is:

```shell
storageAccountId=$(az storage account show \
  --resource-group <resource-group> \
  --name <storage-account> \
  --query id \
  --output tsv)

az role assignment create \
  --assignee-object-id <managed-identity-principal-id> \
  --assignee-principal-type ServicePrincipal \
  --role "Storage Table Data Contributor" \
  --scope "$storageAccountId"
```

Azure role assignments can take several minutes to propagate. See
[Assign an Azure role for access to table data](https://learn.microsoft.com/azure/storage/tables/assign-azure-role-data-access)
and the
[Storage Table Data Contributor role definition](https://learn.microsoft.com/azure/role-based-access-control/built-in-roles/storage#storage-table-data-contributor).

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
       │                    │
       ▼                    ▼
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
 /api/delegated
 /api/app
 /api/notifications
```

## Security Considerations

1. Webhook endpoints are unauthenticated (as required by Graph) but validate incoming data via validationTokens JWT checks and clientState matching.
1. API endpoints require Entra ID Bearer tokens validated against JWKS.
1. Input validation uses strict regex patterns via validateParams.ts to prevent injection.
1. HTML escaping via escapeHtml prevents XSS when echoing validation tokens.
1. Rate limiting is applied globally via express-rate-limit.
1. Tenant verification on both webhook and lifecycle handlers ensures only notifications from the configured tenant are processed