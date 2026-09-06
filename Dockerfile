FROM node:20-alpine AS base

WORKDIR /app

# Basis-Pakete
RUN apk add --no-cache curl ca-certificates

# Quellcode kopieren
COPY shop-kern/ ./

# Verzeichnisse anlegen
RUN mkdir -p data/logs data/backups public modules

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8080/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js", "8080"]
