# syntax=docker/dockerfile:1
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

# Base packages
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Dependencies first for better caching
COPY package*.json ./
RUN npm config set fund false && npm config set audit false \
 && if [ -f package-lock.json ] ; then npm ci --omit=dev ; else npm install --omit=dev ; fi

# Copy source as root (no chown needed when running as root)
COPY . .

# Optional: create /data in image; bind mount may overlay this at runtime
RUN mkdir -p /data

# No USER instruction → default runtime user is root
# USER root  # (implicit)

ARG EXPOSE_PORT=7810
ENV PORT=${EXPOSE_PORT}
EXPOSE ${EXPOSE_PORT}

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT}/health" || exit 1

# Start the server (e.g., via "npm start")
CMD ["npm", "start"]
