# Graph webhooks testbed

The idea is to have a web application to test Microsoft Graph subscriptions.

The web application should have a backend that will be used to store the subscriptions information and an endpoint to receive notifications via webhooks.

The web application will use typescript as programmin language and will use azure storage account tables for storage.

The web application needs to have authentication using the MSAL library using the msal-browser library for javascript. Authentication will use the Entra ID Authorization code flow with PKCE. The app registration details will be provided via environment variables.

When a webhook notification is received, the body of the webhook must be stored in a database along with information of when it was received and the user that set up the subscription.

The main page of the web application, after the user has logged in, will show two tables. The first table will show the list of subscriptions that the user has created, when they are going to expire and the last time that a notification was received. The second table will show a list of all the notifications that the user has received for his subscriptions. Each notification will have a details link that will navigate to a details page that will show the full body of the notification that was received and stored in the database. Since the body is a json object, the json should be pretty printed.
