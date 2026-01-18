FROM node:20-slim AS builder

WORKDIR /app

# Copy root package files
COPY package.json ./
COPY packages/api/package.json ./packages/api/

# Install dependencies
RUN npm install --workspace=@ihd/api

# Copy source
COPY packages/api ./packages/api

# Build
RUN npm run build -w @ihd/api

# Production stage
FROM node:20-slim

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/api/package.json ./packages/api/
COPY --from=builder /app/packages/api/dist ./packages/api/dist
COPY --from=builder /app/node_modules ./node_modules

# Copy web dist for serving static files
COPY packages/web/dist ./packages/web/dist

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "packages/api/dist/index.js"]
