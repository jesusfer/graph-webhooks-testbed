import dotenv from 'dotenv';
dotenv.config();

export const config = {
    port: parseInt(process.env.PORT || '3000', 10),
    sessionSecret: process.env.SESSION_SECRET || 'change-me',

    // Entra ID
    entra: {
        clientId: process.env.AZURE_CLIENT_ID || '',
        tenantId: process.env.AZURE_TENANT_ID || '',
        redirectUri: process.env.AZURE_REDIRECT_URI || 'http://localhost:3000',
    },

    // Azure Storage
    storageConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || '',

    // Graph
    graphNotificationUrl: process.env.GRAPH_NOTIFICATION_URL || '',
};
