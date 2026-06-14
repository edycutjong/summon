# syntax=docker/dockerfile:1
# ── Build stage ──────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ── Runtime stage ────────────────────────────────────────────
FROM node:20-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
# Background worker: connects out to the CROO WebSocket + Telegram — no inbound port.
CMD ["node", "dist/index.js"]
