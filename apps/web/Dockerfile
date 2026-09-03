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
COPY apps/web/tsconfig.json apps/web/tsconfig.json
COPY apps/web/index.html apps/web/index.html
COPY apps/web/vite.config.ts apps/web/vite.config.ts
COPY apps/web/src apps/web/src
COPY packages/shared packages/shared

# Build Web (tsc + vite build)
RUN npm run build --workspace=@wawi/web

# Runtime: nginx serves static files
FROM nginx:alpine

COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
