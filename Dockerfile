# ================================================================
#  Emergency Response Network (ERN) — Production Dockerfile
#  Lightweight, secure Node 20 Alpine image
# ================================================================

FROM node:20-alpine AS production

# Set working directory
WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Ensure uploads directory exists
RUN mkdir -p /app/uploads

# Expose server port
EXPOSE 5000

# Set environment defaults
ENV NODE_ENV=production
ENV PORT=5000

# Health check against Express /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

# Start the application
CMD ["node", "index.js"]
