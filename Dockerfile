# syntax=docker/dockerfile:1

# ==================== Backend Build ====================
FROM oven/bun:latest AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

FROM oven/bun:latest AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY tsconfig.json ./
COPY src ./src
RUN bun run build

# ==================== Web GUI Build ====================
FROM oven/bun:latest AS web-deps
WORKDIR /app/web
COPY web/package.json web/bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

FROM oven/bun:latest AS web-build
WORKDIR /app/web
COPY --from=web-deps /app/web/node_modules ./node_modules
COPY web/ ./
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN bun run build

# ==================== Final Runner ====================
FROM oven/bun:latest AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install system dependencies
# Note: oven/bun is Debian-based, not Alpine — use apt instead of apk
RUN apt-get update && apt-get install -y --no-install-recommends \
    rclone fuse3 curl ca-certificates supervisor \
    && rm -rf /var/lib/apt/lists/* \
    && printf 'user_allow_other\n' >> /etc/fuse.conf || true

# Copy backend
COPY package.json ./
RUN bun install --production
COPY --from=build /app/dist ./dist

# Copy web GUI
COPY --from=web-build /app/web/.next ./web/.next
COPY --from=web-build /app/web/public ./web/public
COPY --from=web-build /app/web/package.json ./web/
COPY --from=web-build /app/web/node_modules ./web/node_modules

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Expose ports: 8978 for backend API, 3000 for web GUI
EXPOSE 8978 3000 7000

# Environment variable to control web GUI
ENV RUN_WEB_GUI=false
ENV WEB_PORT=3000
ENV BACKEND_URL=http://localhost:8978

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["serve"]
