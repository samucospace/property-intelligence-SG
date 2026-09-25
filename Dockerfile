# Stage 1: Build Frontend
FROM node:20-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Production Server Runtime
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Copy server package manifest and install production dependencies only
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy server application code
COPY server/ ./server/

# Copy compiled frontend from Stage 1 into client/dist for Express static serving
COPY --from=client-builder /app/client/dist ./client/dist

# Expose server port
EXPOSE 3001

# Start the unified production server
CMD ["node", "server/index.js"]
