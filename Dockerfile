# Stage 1: Build Frontend
FROM node:22.23.3-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Production Server Runtime
FROM node:22.23.3-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV TZ=Asia/Singapore
# Heavy SQLite operations share the native worker pool; keep capacity for readiness
# and metadata reads on their reserved connection.
ENV UV_THREADPOOL_SIZE=16

# Install tzdata for Singapore timezone and build essentials for native sqlite3 binaries
RUN apk add --no-cache tzdata python3 make g++ aws-cli

# Ensure persistent data directory exists
RUN mkdir -p /app/data

# Copy server package manifest and install production dependencies only
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Docker supervises one process per container; maintenance is an explicit profile.
COPY server/ ./server/

# Copy compiled frontend from Stage 1 into client/dist for Express static serving
COPY --from=client-builder /app/client/dist ./client/dist

# Set ownership to node user
RUN chown -R node:node /app

# Switch to non-root user
USER node

# Expose server port
EXPOSE 3001

# Web deployment never starts maintenance.
CMD ["node", "server/index.js"]
