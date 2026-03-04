# -- Build stage --
FROM node:24-alpine AS build

WORKDIR /app

# Install backend dependencies
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm ci

# Install frontend dependencies
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm ci

# Copy source and configs
COPY backend/tsconfig.json ./backend/
COPY backend/src/ ./backend/src/
COPY frontend/esbuild.config.mjs ./frontend/
COPY frontend/tsconfig.json ./frontend/
COPY frontend/src/ ./frontend/src/

# Build both
RUN cd backend && npm run build
RUN cd frontend && npm run build

# -- Production stage --
FROM node:24-alpine AS final

WORKDIR /app

ENV NODE_ENV=production

COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm ci --omit=dev

COPY --from=build /app/backend/dist/ ./backend/dist/
COPY frontend/public/ ./frontend/public/
COPY --from=build /app/frontend/public/js/app.js ./frontend/public/js/app.js
# COPY --from=build /app/frontend/public/js/app.js.map ./frontend/public/js/app.js.map
COPY --from=build /app/frontend/node_modules/@azure/msal-browser/lib/redirect-bridge/msal-redirect-bridge.min.js ./frontend/public/lib/msal-redirect-bridge.js

EXPOSE 3000

RUN addgroup -S nodegroup && adduser -S nodeuser -G nodegroup && chown -R nodeuser:nodegroup /app

USER nodeuser

CMD ["node", "backend/dist/server.js"]
