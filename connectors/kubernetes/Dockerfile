# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:24-alpine

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built files
COPY --from=builder /app/dist ./dist

# Copy metadata
COPY metadata.json ./metadata.json

# Set environment variables
ENV NODE_ENV=production
ENV BACKEND_API_URL=http://painchain-app:8000/api

# Run the connector
CMD ["node", "dist/index.js"]
