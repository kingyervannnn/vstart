# Note: BuildKit-specific syntax removed to avoid pulling docker/dockerfile:1.6 during outages

# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy only dependency manifests first for better caching
COPY package.json ./
COPY pnpm-lock.yaml ./

# Install pnpm globally using npm
RUN npm install -g pnpm@latest \
    && pnpm config set registry https://registry.npmjs.org/ \
    && pnpm config set fetch-retries 5 \
    && pnpm config set fetch-timeout 120000 \
    && pnpm config set network-concurrency 8

# Pre-fetch deps (no BuildKit cache mount)
RUN pnpm fetch --frozen-lockfile || true

# Now copy the rest of the source
COPY . .

# Install and build (no BuildKit cache mount)
RUN pnpm install --frozen-lockfile \
    && pnpm run build

# Production stage
FROM nginx:alpine

# Copy built files to nginx
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Expose port (match your nginx.conf upstream)
EXPOSE 3000

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
