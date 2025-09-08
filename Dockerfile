# Use latest Node.js 24 slim image
FROM node:24-slim AS build

# Set working directory
WORKDIR /app

# Install git + CA certificates for HTTPS clone
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Clone Tube Search repo
RUN git clone https://github.com/FastZet/Tube-Search.git .

# Install only production dependencies
RUN npm ci --omit=dev

# --------- Final minimal image ---------
FROM node:24-slim

# Set working directory
WORKDIR /app

# Copy built app from builder
COPY --from=build /app /app

# Set environment variables
ENV NODE_ENV=production
ENV PORT=7860

# Expose application port
EXPOSE 7860

# Run the application as non-root user for security
RUN useradd -m appuser && chown -R appuser /app
USER appuser

# Start the server
CMD ["npm", "start"]
