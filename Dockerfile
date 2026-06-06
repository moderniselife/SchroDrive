# syntax=docker/dockerfile:1

# ==================== Backend Build ====================
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ==================== Web GUI Build ====================
FROM node:20-alpine AS web-deps
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install

FROM node:20-alpine AS web-build
WORKDIR /app/web
COPY --from=web-deps /app/web/node_modules ./node_modules
COPY web/ ./
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# ==================== Final Runner ====================
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install system dependencies
RUN apk add --no-cache rclone fuse3 curl ca-certificates supervisor && update-ca-certificates
RUN printf 'user_allow_other\n' >> /etc/fuse.conf || true

# Copy backend
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist

# Copy web GUI
COPY --from=web-build /app/web/.next ./web/.next
COPY --from=web-build /app/web/public ./web/public
COPY --from=web-build /app/web/package*.json ./web/
COPY --from=web-build /app/web/node_modules ./web/node_modules

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Expose ports: 8978 for backend API, 3000 for web GUI
EXPOSE 8978 3000

# Environment variable to control web GUI
ENV RUN_WEB_GUI=false
ENV WEB_PORT=3000
ENV BACKEND_URL=http://localhost:8978

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["serve"]
