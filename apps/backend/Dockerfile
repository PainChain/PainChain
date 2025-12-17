# Backend Dockerfile for PainChain NestJS API
# Use Alpine 3.20 to avoid busybox QEMU issues on ARM64
FROM node:20-alpine3.20 AS base

# Install OpenSSL (required by Prisma) and pnpm
RUN apk add --no-cache openssl openssl-dev && \
    npm install -g pnpm@8.15.0

# Build stage
FROM base AS builder

WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY turbo.json ./

# Copy packages
COPY packages ./packages

# Copy backend app
COPY apps/backend ./apps/backend

# Install dependencies
RUN pnpm install --frozen-lockfile

# Generate Prisma Client
RUN cd apps/backend && pnpm prisma generate

# Build the application
RUN pnpm build --filter=@painchain/backend

# Production stage
FROM base AS production

WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY turbo.json ./

# Copy packages
COPY packages ./packages

# Copy backend app
COPY apps/backend/package.json ./apps/backend/
COPY --from=builder /app/apps/backend/prisma ./apps/backend/prisma

# Install all dependencies (including Prisma CLI)
RUN pnpm install --frozen-lockfile --filter=@painchain/backend

# Copy built application from builder
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/packages/types/dist ./packages/types/dist

WORKDIR /app/apps/backend

# Generate Prisma client
RUN pnpm prisma generate

EXPOSE 8000

# Start the application
CMD ["node", "dist/main.js"]
