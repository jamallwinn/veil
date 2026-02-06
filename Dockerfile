# Veil Private XRP Payments - Cloud Run Dockerfile
# Multi-stage build for optimized production image

# =============================================================================
# Stage 1: Build the React application
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code and configuration
COPY src/ ./src/
COPY public/ ./public/
COPY index.html ./
COPY vite.config.ts ./
COPY tsconfig.json ./
COPY tsconfig.node.json ./
COPY tailwind.config.js ./
COPY postcss.config.js ./

# Copy ZK build artifacts (required for proof generation)
COPY build/withdraw_final.zkey ./build/
COPY build/verification_key.json ./build/
COPY build/withdraw_js/ ./build/withdraw_js/

# Set environment variables for build
ENV NODE_ENV=production

# Build the application
RUN npm run build

# =============================================================================
# Stage 2: Production image with nginx
# =============================================================================
FROM nginx:alpine AS production

# Install curl for health checks
RUN apk add --no-cache curl

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy ZK artifacts to be served statically
# These are large files needed by the browser for proof generation
COPY --from=builder /app/build/withdraw_final.zkey /usr/share/nginx/html/zk/
COPY --from=builder /app/build/verification_key.json /usr/share/nginx/html/zk/
COPY --from=builder /app/build/withdraw_js/withdraw.wasm /usr/share/nginx/html/zk/
COPY --from=builder /app/build/withdraw_js/witness_calculator.js /usr/share/nginx/html/zk/
COPY --from=builder /app/build/withdraw_js/generate_witness.js /usr/share/nginx/html/zk/

# Cloud Run uses PORT environment variable
ENV PORT=8080
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
