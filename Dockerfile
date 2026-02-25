# -- Build stage --
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build && npm run build:frontend

# -- Production stage --
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=build /app/dist/ ./dist/
COPY public/ ./public/
COPY --from=build /app/public/js/app.js ./public/js/app.js
COPY --from=build /app/public/js/app.js.map ./public/js/app.js.map

EXPOSE 3000

CMD ["node", "dist/server.js"]
