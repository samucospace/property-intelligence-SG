# Stage 1: Build Frontend
FROM node:22-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Production Server Runtime
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV TZ=Asia/Singapore

# Install tzdata for Singapore timezone and build essentials for native sqlite3 binaries
RUN apk add --no-cache tzdata python3 make g++

# Ensure persistent data directory exists
RUN mkdir -p /app/data

# Install PM2 globally for background cron execution and process management (pinned version)
RUN npm install -g pm2@5.4.3 && mkdir -p /home/node/.pm2 && chown -R node:node /home/node

# Copy server package manifest and install production dependencies only
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy PM2 ecosystem configuration and server application code
COPY ecosystem.config.cjs ./
COPY server/ ./server/

# Copy compiled frontend from Stage 1 into client/dist for Express static serving
COPY --from=client-builder /app/client/dist ./client/dist

# Set ownership to node user
RUN chown -R node:node /app

# Switch to non-root user
USER node

# Expose server port
EXPOSE 3001

# Start the unified production server and background cron processes
CMD ["pm2-runtime", "ecosystem.config.cjs"]
