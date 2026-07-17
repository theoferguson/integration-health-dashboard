FROM node:20-slim AS builder

WORKDIR /app

# better-sqlite3 is a native addon - if no prebuilt binary matches this
# platform/Node ABI, node-gyp needs a C++ toolchain to compile from source,
# which node:20-slim doesn't include by default. Builder-stage only, doesn't
# carry into the production image.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy root + every workspace package.json that @ihd/api depends on, so npm
# can resolve @ihd/shared as a local workspace link instead of trying to
# fetch it from the registry - it's a private, unpublished package. The root
# tsconfig.json is needed too - every package's tsconfig extends it.
COPY package.json tsconfig.json ./
COPY packages/api/package.json ./packages/api/
COPY packages/shared/package.json ./packages/shared/

RUN npm install --workspace=@ihd/api

# Copy source and build. @ihd/shared builds first - @ihd/api imports its
# compiled dist/ output, both at typecheck time and at runtime.
COPY packages/shared ./packages/shared
COPY packages/api ./packages/api

RUN npm run build -w @ihd/shared
RUN npm run build -w @ihd/api

# Production stage
FROM node:20-slim

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/api/package.json ./packages/api/
COPY --from=builder /app/packages/api/dist ./packages/api/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/node_modules ./node_modules

# Copy web dist for serving static files - built locally before `fly deploy`,
# not built inside this Dockerfile.
COPY packages/web/dist ./packages/web/dist

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "packages/api/dist/index.js"]
