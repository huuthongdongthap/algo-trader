# Stage 1: Build
FROM node:22-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy manifests first for layer caching
COPY package.json pnpm-lock.yaml* ./

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

RUN pnpm run build

# Stage 2: Production runtime
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY package.json pnpm-lock.yaml* ./

# Production deps only (ignore scripts — no build tools in runner)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

COPY --from=builder /app/dist ./dist

# Create data dir with correct ownership
RUN mkdir -p /app/data && chown -R appuser:appgroup /app

USER appuser

# API | Dashboard | Webhooks
EXPOSE 3000 3001 3002

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "dist/cli/index.js"]
