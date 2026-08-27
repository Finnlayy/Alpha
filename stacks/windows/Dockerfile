# =========================================================
# Projekt:Alpha — Windows-Portal (Blueprint v1.2.0)
# Build-Kontext: REPO-ROOT (npm-Vite-Build + TS-Server nötig)
#   docker build -f stacks/windows/Dockerfile -t alpha-windows-portal .
# =========================================================

# --- Stage 1: React-Dashboard (Vite Build, Design-Reference: Kraken Runner)
FROM node:22-alpine AS dashboard
WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

# --- Stage 2: TS-Server (Fastify + GA + Academy)
FROM node:22-alpine AS tsbuild
WORKDIR /build
COPY stacks/windows/ts-server/package.json stacks/windows/ts-server/package-lock.json* ./ts-server/
RUN cd ts-server && npm ci --no-audit --no-fund
COPY stacks/windows/ts-server ./ts-server
RUN cd ts-server && npm run build

# --- Stage 3: Runtime (Windows-Host 192.168.178.60, Docker)
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    ALPHA_CORE_URL=http://192.168.178.50:8000 \
    ALPHA_DATA_DIR=/data \
    PUBLIC_DIR=/app/public
WORKDIR /app
COPY --from=dashboard /build/dist ./public
COPY --from=tsbuild /build/ts-server/dist ./dist
COPY --from=tsbuild /build/ts-server/package.json ./
COPY --from=tsbuild /build/ts-server/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm i --omit=dev --no-audit --no-fund
# NFS-Target (Z:\data) wird von außen gemountet
RUN mkdir -p /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/healthz || exit 1
CMD ["node", "dist/server.js"]
