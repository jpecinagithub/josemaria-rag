# syntax=docker/dockerfile:1
# --- Build del frontend (Vite + React) ---
FROM node:24-bookworm-slim AS web
WORKDIR /web
COPY apps/frontend/package.json apps/frontend/package-lock.json ./
RUN npm ci
COPY apps/frontend/ ./
RUN npm run build

# --- Build del backend (TypeScript) ---
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY apps/backend/package.json apps/backend/package-lock.json ./
RUN npm ci
COPY apps/backend/tsconfig.json ./
COPY apps/backend/src ./src
RUN npm run build

# --- Runtime ---
FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY apps/backend/package.json apps/backend/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=web /web/dist ./public
ENV STATIC_DIR=/app/public
ENV PDF_PATH=/app/data/book.pdf
ENV DATA_DIR=/app/data
EXPOSE 8100
CMD ["node", "dist/server.js"]
