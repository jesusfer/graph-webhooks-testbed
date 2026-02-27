# -- Build stage --
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY esbuild.config.mjs ./
COPY src/ ./src/

RUN npm run build && npm run build:frontend

# -- Production stage --
FROM node:24-alpine AS final

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=build /app/dist/ ./dist/
COPY public/ ./public/
COPY --from=build /app/public/js/app.js ./public/js/app.js
COPY --from=build /app/public/js/app.js.map ./public/js/app.js.map
COPY --from=build /app/node_modules/@azure/msal-browser/lib/redirect-bridge/msal-redirect-bridge.min.js ./public/lib/msal-redirect-bridge.js

EXPOSE 3000

CMD ["node", "dist/backend/server.js"]
