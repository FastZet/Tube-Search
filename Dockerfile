# syntax=docker/dockerfile:1
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

# Removed: chromium, fonts-liberation (no longer needed for Google scraping)
# Kept:    python3 (yt-dlp dep), ffmpeg, curl, ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates python3 ffmpeg \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
       -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm config set fund false && npm config set audit false \
 && if [ -f package-lock.json ] ; then npm ci --omit=dev ; else npm install --omit=dev ; fi

COPY . .
RUN mkdir -p /data

ARG EXPOSE_PORT=7810
ENV PORT=${EXPOSE_PORT}
EXPOSE ${EXPOSE_PORT}

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT}/health" || exit 1

CMD ["npm", "start"]
