FROM node:26-alpine AS build

WORKDIR /app

# Install dependencies (monorepo: all workspace packages)
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci --ignore-scripts

# Copy source
COPY tsconfig.json ./
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/drizzle.config.cjs apps/api/drizzle.config.cjs
COPY apps/api/src apps/api/src
COPY packages/shared packages/shared

# Build API
RUN npm run build --workspace=@wawi/api

# Runtime
FROM node:26-alpine

RUN apk add --no-cache tini curl
WORKDIR /app

COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/drizzle ./drizzle
COPY --from=build /app/apps/api/drizzle.config.cjs ./drizzle.config.cjs
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -sf http://127.0.0.1:${PORT:-8080}/ready || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
