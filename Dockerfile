FROM node:20-alpine AS base

WORKDIR /app

# Basis-Pakete
RUN apk add --no-cache curl ca-certificates

# Quellcode kopieren
COPY shop-kern/ ./

# Verzeichnisse anlegen
RUN mkdir -p data/logs data/backups public modules

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "const h=require('http');function chk(p,cb){h.get('http://127.0.0.1:8080'+p,(r)=>cb(r.statusCode===200)).on('error',()=>cb(false));}chk('/ready',(ok)=>{if(ok)process.exit(0);chk('/health',(ok2)=>{if(ok2)process.exit(0);chk('/api/health',(ok3)=>process.exit(ok3?0:1));});})"

CMD ["node", "server.js", "8080"]
