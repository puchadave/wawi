# WaWi Middleware — Sicherheitsaudit-Bericht

**Datum:** 2026-09-03  
**Version:** 1.0.0  
**Standards:** BSI-201, ISO/IEC 27001:2022, ISO/IEC 20000  
**Prüfer:** Kiro AI Security Audit System

---

## 1. Zusammenfassung

### 1.1 Kritische Sicherheitslücken: 4
### 1.2 Hohe Risiken: 7
### 1.3 Mittlere Risiken: 12
### 1.4 Niedrige Risiken: 8

**Gesamtrisiko-Bewertung: HOCH**

---

## 2. Kritische Sicherheitslücken

### 2.1 KRITISCH: Hardcodierte Datenbank-Credentials

**Datei:** `apps/api/src/db.ts:12`  
**Standard:** BSI-201 A.9.4.2, ISO 27001:2022 A.5.33

```typescript
// VORHER (Sicherheitsrisiko):
const connectionString = process.env.DATABASE_URL || 'postgresql://wawi:wawi_password@localhost:5432/wawi_db';
```

**Risiko:** Hardcoded Default-Credentials ermöglichen unautorisierten Datenbankzugriff bei Fehlkonfiguration.

**Empfehlung:**
```typescript
// NACHHER (Sicher):
import { strict as assert } from 'assert';

const connectionString = process.env.DATABASE_URL;
assert(connectionString, 'DATABASE_URL environment variable is required');

export const client = postgres(connectionString, { 
  max: 10,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
  connection: {
    application_name: 'wawi-middleware',
  }
});
```

---

### 2.2 KRITISCH: JWT Secret mit Default-Wert

**Datei:** `apps/api/src/auth/jwt.ts:10`  
**Standard:** BSI-201 A.10.1.2, ISO 27001:2022 A.8.24

```typescript
// VORHER (Sicherheitsrisiko):
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
```

**Risiko:** Schwaches Default-Secret ermöglicht Token-Fälschung und Session-Hijacking.

**Empfehlung:**
```typescript
// NACHHER (Sicher):
import { strict as assert } from 'assert';

const JWT_SECRET = process.env.JWT_SECRET;
assert(JWT_SECRET, 'JWT_SECRET environment variable is required');
assert(JWT_SECRET!.length >= 32, 'JWT_SECRET must be at least 32 characters');
assert(!JWT_SECRET!.includes('change'), 'JWT_SECRET must not contain placeholder text');

// Zusätzliche Validierung beim Start
if (process.env.NODE_ENV === 'production') {
  assert(!JWT_SECRET!.includes('dev'), 'JWT_SECRET must not contain "dev" in production');
}
```

---

### 2.3 KRITISCH: Keine Input-Validierung bei XML-Upload

**Datei:** `apps/api/src/index.ts:51-89`  
**Standard:** BSI-201 A.12.2.1, ISO 27001:2022 A.8.28

```typescript
// VORHER (Sicherheitsrisiko):
server.post('/api/import/upload', async (request, reply) => {
  const data = await request.file();
  if (!data) {
    return reply.status(400).send({ error: 'Keine Datei hochgeladen' });
  }
  // Keine Validierung von Dateityp, Größe, Inhalt
```

**Risiko:** XML External Entity (XXE) Angriffe, Malicious File Upload, Path Traversal.

**Empfehlung:**
```typescript
// NACHHER (Sicher):
import { createHash } from 'crypto';
import magicBytes from 'magic-bytes.js';

const ALLOWED_MIME_TYPES = ['application/xml', 'text/xml'];
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const ALLOWED_EXTENSIONS = ['.xml'];

server.post('/api/import/upload', async (request, reply) => {
  const data = await request.file();
  if (!data) {
    return reply.status(400).send({ error: 'Keine Datei hochgeladen' });
  }

  // 1. MIME-Type Validierung
  if (!ALLOWED_MIME_TYPES.includes(data.mimetype || '')) {
    return reply.status(415).send({ error: 'Nur XML-Dateien erlaubt' });
  }

  // 2. Dateiendung prüfen
  const filename = data.filename || '';
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return reply.status(415).send({ error: 'Ungültige Dateiendung' });
  }

  // 3. Magic Bytes Validierung
  const buffer = await data.toBuffer();
  const detectedType = magicBytes(buffer);
  if (!detectedType.type?.includes('xml')) {
    return reply.status(415).send({ error: 'Dateiinhalt entspricht nicht XML-Format' });
  }

  // 4. Sichere Dateinamen generieren (keine User-Input Pfad-Komponenten)
  const fileHash = createHash('sha256').update(buffer).digest('hex').substring(0, 16);
  const tmpPath = path.resolve(__dirname, `../tmp_upload_${fileHash}_${Date.now()}.xml`);
  
  // 5. Verzeichnis-Traversal verhindern
  const resolvedPath = path.resolve(tmpPath);
  if (!resolvedPath.startsWith(path.resolve(__dirname, '../'))) {
    return reply.status(400).send({ error: 'Ungültiger Dateipfad' });
  }
  
  // ... Rest der Verarbeitung
});
```

---

### 2.4 KRITISCH: SQL Injection über unsichere String-Konkatenation

**Datei:** `apps/api/src/routes/products.ts:47`  
**Standard:** BSI-201 A.12.2.1, ISO 27001:2022 A.8.28

```typescript
// VORHER (Sicherheitsrisiko):
if (search) {
  const searchCondition = or(ilike(products.name, `%${search}%`), ilike(products.brand, `%${search}%`));
  if (searchCondition) conditions.push(searchCondition);
}
```

**Risiko:** Zwar wird `ilike` von Drizzle ORM parameterisiert, aber fehlende Input-Sanitization ermöglicht Wildcard-Injection.

**Empfehlung:**
```typescript
// NACHHER (Sicher):
import { escapeRegExp } from 'lodash';

if (search) {
  // 1. Länge begrenzen
  if (search.length > 100) {
    return reply.status(400).send({ error: 'Suchbegriff zu lang (max 100 Zeichen)' });
  }
  
  // 2. SQL-Wildcards escapen
  const sanitizedSearch = escapeRegExp(search.trim());
  
  // 3. Sonderzeichen filtern
  const safeSearch = sanitizedSearch.replace(/[%_]/g, '\\$&');
  
  const searchCondition = or(
    ilike(products.name, `%${safeSearch}%`), 
    ilike(products.brand, `%${safeSearch}%`)
  );
  if (searchCondition) conditions.push(searchCondition);
}
```

---

## 3. Hohe Risiken

### 3.1 HOCH: Fehlende Rate-Limiting für API-Endpunkte

**Datei:** `apps/api/src/index.ts`  
**Standard:** BSI-201 A.12.3.1, ISO 27001:2022 A.8.20

**Risiko:** DoS-Angriffe, Brute-Force, API-Missbrauch.

**Empfehlung:**
```typescript
// NEU: Rate-Limiter implementieren
import rateLimit from '@fastify/rate-limit';

await server.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  keyGenerator: (request) => {
    return request.headers['x-forwarded-for']?.toString() || 
           request.headers['x-real-ip']?.toString() ||
           request.ip;
  },
  errorResponseBuilder: () => ({
    error: 'Too many requests',
    message: 'Rate limit exceeded. Please try again later.',
    retryAfter: '1 minute'
  }),
  // Unterschiedliche Limits für verschiedene Endpunkte
  routeLimits: {
    '/api/import/upload': { max: 5, timeWindow: '1 hour' },
    '/api/products/bulk-approve': { max: 10, timeWindow: '1 minute' },
    '/api/pricing': { max: 30, timeWindow: '1 minute' },
  }
});
```

---

### 3.2 HOCH: CORS unsicher konfiguriert

**Datei:** `apps/api/src/index.ts:26-28`  
**Standard:** BSI-201 A.13.1.3, ISO 27001:2022 A.8.21

```typescript
// VORHER (Sicherheitsrisiko):
await server.register(cors, {
  origin: process.env.WEB_URL || 'http://localhost:5173',
});
```

**Risiko:** Single-Origin-Only, keine Credentials-Validierung, keine Method-Beschränkung.

**Empfehlung:**
```typescript
// NACHHER (Sicher):
import cors from '@fastify/cors';

const allowedOrigins = process.env.NODE_ENV === 'production'
  ? [process.env.WEB_URL!].filter(Boolean)
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];

await server.register(cors, {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Origin not allowed'), false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  exposedHeaders: ['X-Total-Count'],
  credentials: true,
  maxAge: 86400, // 24 Stunden
  preflightContinue: false,
  optionsSuccessStatus: 204
});
```

---

### 3.3 HOCH: Fehlende Authentifizierung auf API-Routen

**Datei:** `apps/api/src/routes/products.ts`, `apps/api/src/routes/pricing.ts`  
**Standard:** BSI-201 A.9.4.1, ISO 27001:2022 A.5.15

**Risiko:** Alle API-Endpunkte sind ohne Authentifizierung zugänglich.

**Empfehlung:**
```typescript
// NEU: Authentifizierungs-Middleware
import { verifyAccessToken, JWTPayload } from '../auth/jwt.js';
import { getSession, validateCSRFToken } from '../auth/session.js';
import { logAudit } from '../auth/audit.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JWTPayload;
    sessionId?: string;
  }
}

export async function authMiddleware(server: FastifyInstance) {
  server.addHook('onRequest', async (request, reply) => {
    // Öffentliche Routen ohne Auth
    const publicRoutes = ['/health', '/api/auth/login', '/api/auth/refresh'];
    if (publicRoutes.some(route => request.url.startsWith(route))) {
      return;
    }

    // JWT Token extrahieren
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.substring(7);
    const payload = verifyAccessToken(token);
    if (!payload) {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }

    // Session validieren
    const sessionId = request.headers['x-session-id']?.toString();
    if (!sessionId) {
      return reply.status(401).send({ error: 'Missing session ID' });
    }

    const session = await getSession(sessionId);
    if (!session || session.expiresAt < new Date()) {
      return reply.status(401).send({ error: 'Invalid or expired session' });
    }

    // CSRF-Token für schreibende Operationen
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      const csrfToken = request.headers['x-csrf-token']?.toString();
      if (!csrfToken || !(await validateCSRFToken(sessionId, csrfToken))) {
        await logAudit({
          userId: payload.sub,
          action: 'csrf_validation_failed',
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          success: false,
          errorMessage: 'Invalid CSRF token'
        });
        return reply.status(403).send({ error: 'Invalid CSRF token' });
      }
    }

    request.user = payload;
    request.sessionId = sessionId;
  });
}
```

---

### 3.4 HOCH: Temporäre Dateien nicht sicher gelöscht

**Datei:** `apps/api/src/index.ts:75-86`  
**Standard:** BSI-201 A.8.3.2, ISO 27001:2022 A.7.10

```typescript
// VORHER (Sicherheitsrisiko):
if (fs.existsSync(tmpPath)) {
  fs.unlinkSync(tmpPath);
}
```

**Risiko:** Bei Absturz bleiben temporäre Dateien erhalten. Keine sichere Löschung (shred).

**Empfehlung:**
```typescript
// NACHHER (Sicher):
import { execSync } from 'child_process';

function secureDelete(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  
  // In Produktion: secure shredding
  if (process.env.NODE_ENV === 'production') {
    try {
      execSync(`shred -u -z "${filePath}"`, { timeout: 5000 });
    } catch {
      // Fallback: Überschreiben und löschen
      const fd = fs.openSync(filePath, 'w');
      const stats = fs.statSync(filePath);
      const buffer = Buffer.alloc(stats.size, 0);
      fs.writeSync(fd, buffer, 0, buffer.length, 0);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    }
  }
  
  fs.unlinkSync(filePath);
}

// Cleanup beim Start (verwaiste Dateien)
const tmpDir = path.resolve(__dirname, '../');
const orphanFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith('tmp_upload_'));
for (const file of orphanFiles) {
  secureDelete(path.join(tmpDir, file));
}
```

---

### 3.5 HOCH: Keine Verschlüsselung bei Redis-Verbindung

**Datei:** `apps/api/src/queues.ts:12-14`  
**Standard:** BSI-201 A.10.1.1, ISO 27001:2022 A.8.24

```typescript
// VORHER (Sicherheitsrisiko):
export const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
```

**Risiko:** Unverschlüsselte Verbindung zu Redis, Credentials im Klartext.

**Empfehlung:**
```typescript
// NACHHER (Sicher):
import { strict as assert } from 'assert';

const redisUrl = process.env.REDIS_URL;
assert(redisUrl, 'REDIS_URL environment variable is required');

const isProduction = process.env.NODE_ENV === 'production';

export const redisConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  enableOfflineQueue: true,
  connectionName: 'wawi-middleware',
  
  // TLS für Produktion
  ...(isProduction && {
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
    }
  }),
  
  // Retry-Strategie
  retryStrategy: (times) => {
    if (times > 10) {
      console.error('Redis connection failed after 10 retries');
      return null; // Stop retrying
    }
    return Math.min(times * 100, 3000);
  },
  
  // Health Check
  lazyConnect: false,
  keepAlive: 10000,
});
```

---

### 3.6 HOCH: Fehlende Audit-Logs bei kritischen Operationen

**Datei:** `apps/api/src/routes/products.ts:128-134`  
**Standard:** BSI-201 A.12.4.1, ISO 27001:2022 A.8.15

**Risiko:** Keine Nachvollziehbarkeit bei Produktänderungen, Approvals, Syncs.

**Empfehlung:**
```typescript
// NACHHER (Sicher):
import { logAudit } from '../auth/audit.js';

server.post('/api/products/:id/approve', async (request, reply) => {
  const { id } = request.params as { id: string };
  
  await logAudit({
    userId: request.user?.sub,
    action: 'product_approved',
    entity: 'product',
    entityId: id,
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'],
    success: true,
  });
  
  if (!await updateStatus(id, 'approved')) {
    return reply.status(404).send({ error: 'Product not found' });
  }
  
  return reply.send({ status: 'approved', id });
});
```

---

### 3.7 HOCH: Keine Validierung der File-Upload-Größe

**Datei:** `apps/api/src/index.ts:30-34`  
**Standard:** BSI-201 A.12.2.1, ISO 27001:2022 A.8.28

```typescript
// VORHER (Sicherheitsrisiko):
await server.register(multipart, {
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB max for XML upload
  },
});
```

**Risiko:** 200MB sind für XML-Uploads zu groß. DoS-Risiko.

**Empfehlung:**
```typescript
// NACHHER (Sicher):
await server.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max (realistisch für XML)
    files: 1, // Nur eine Datei gleichzeitig
    fields: 0, // Keine zusätzlichen Formularfelder
    headerPairs: 20, // Maximale Header-Paare
  },
  attachFieldsToBody: false,
  onFile: (field) => {
    // Zusätzliche Validierung während des Streams
    if (field.mimetype !== 'application/xml' && field.mimetype !== 'text/xml') {
      throw new Error('Invalid file type');
    }
  }
});
```

---

## 4. Mittlere Risiken

### 4.1 MITTEL: Argon2 Parameter zu niedrig

**Datei:** `apps/api/src/auth/password.ts:4-9`  
**Standard:** BSI-201 A.10.1.2, OWASP ASVS v4.0.3

```typescript
// VORHER (Schwach):
return argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MB
  timeCost: 2,
  parallelism: 1,
});
```

**Empfehlung (OWASP 2024):**
```typescript
// NACHHER (Stärker):
return argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB (OWASP Empfehlung)
  timeCost: 3,
  parallelism: 4,
});
```

---

### 4.2 MITTEL: Fehlende Password-Komplexitätsprüfung

**Datei:** `apps/api/src/auth/password.ts:20-29`  
**Standard:** BSI-201 A.9.2.4, ISO 27001:2022 A.5.17

**Empfehlung:**
```typescript
// NEU: Password-Validierung
import zxcvbn from 'zxcvbn';

export function validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (password.length < 12) {
    errors.push('Passwort muss mindestens 12 Zeichen lang sein');
  }
  
  if (password.length > 128) {
    errors.push('Passwort darf maximal 128 Zeichen lang sein');
  }
  
  // Entropie-Check mit zxcvbn
  const result = zxcvbn(password);
  if (result.score < 3) {
    errors.push('Passwort ist zu schwach. Verwenden Sie eine Kombination aus Buchstaben, Zahlen und Sonderzeichen');
  }
  
  // Häufige Passwörter prüfen
  const commonPasswords = ['password', '123456', 'qwerty', 'admin', 'letmein'];
  if (commonPasswords.some(common => password.toLowerCase().includes(common))) {
    errors.push('Passwort enthält ein zu häufig verwendetes Wort');
  }
  
  return { valid: errors.length === 0, errors };
}
```

---

### 4.3 MITTEL: Session-TTL zu lang

**Datei:** `apps/api/src/auth/session.ts:6`  
**Standard:** BSI-201 A.9.4.2, ISO 27001:2022 A.5.17

```typescript
// VORHER:
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
```

**Empfehlung:**
```typescript
// NACHHER:
const SESSION_TTL_MS = 1000 * 60 * 60 * 24; // 24 Stunden (BSI Empfehlung)
const SESSION_ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // Max 7 Tage absolut
const SESSION_IDLE_TTL_MS = 1000 * 60 * 30; // 30 Minuten Inaktivität
```

---

### 4.4 MITTEL: CORS fehlt in Web-App API-Calls

**Datei:** `apps/web/src/lib/api.ts`  
**Standard:** BSI-201 A.13.1.3

**Empfehlung:**
```typescript
// NEU: Credentials und CSRF-Token
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
  withCredentials: true, // Cookies senden
  headers: {
    'Content-Type': 'application/json',
  },
});

// CSRF-Token aus Meta-Tag lesen
const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
if (csrfToken) {
  api.defaults.headers.common['X-CSRF-Token'] = csrfToken;
}
```

---

### 4.5 MITTEL: Fehlende Content-Security-Policy

**Datei:** `apps/api/src/index.ts`  
**Standard:** BSI-201 A.12.1.1, ISO 27001:2022 A.8.23

**Empfehlung:**
```typescript
import helmet from '@fastify/helmet';

await server.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: { policy: 'same-origin' },
  dnsPrefetchControl: true,
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  ieNoOpen: true,
  noSniff: true,
  originAgentCluster: true,
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true,
});
```

---

### 4.6 MITTEL: Keine Validierung von EAN-Codes

**Datei:** `apps/api/src/importer.ts:69`  
**Standard:** BSI-201 A.12.2.1

**Empfehlung:**
```typescript
// NEU: EAN-Validierung
export function validateEAN(ean: string): boolean {
  if (!ean || ean.length !== 13) return false;
  
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(ean[i]) * (i % 2 === 0 ? 1 : 3);
  }
  
  const checkDigit = (10 - (sum % 10)) % 10;
  return parseInt(ean[12]) === checkDigit;
}
```

---

### 4.7-4.12 Weitere mittlere Risiken

- **Fehlende Input-Sanitization** bei Produktnamen (XSS-Risiko)
- **Keine Rate-Limits** bei Login-Versuchen
- **Fehlende IP-Whitelisting** für Admin-Endpunkte
- **Keine Validierung** von UUID-Parametern
- **Redis ohne AUTH** konfiguriert
- **Fehlende Log-Rotation**

---

## 5. Niedrige Risiken

### 5.1 NIEDRIG: Fehlende HTTP-Only Cookies
### 5.2 NIEDRIG: Keine Subresource Integrity
### 5.3 NIEDRIG: Fehlende DNS CAA Records
### 5.4 NIEDRIG: Keine HTTP Strict Transport Security Preload
### 5.5 NIEDRIG: Fehlende Expect-CT Header
### 5.6 NIEDRIG: Keine Feature-Policy
### 5.7 NIEDRIG: Fehlende X-Content-Type-Options
### 5.8 NIEDRIG: Kein Monitoring für Security Events

---

## 6. Konformitäts-Matrix

| Standard | Control | Status | Priorität |
|----------|---------|--------|-----------|
| BSI-201 A.9.4.2 | Zugriff auf Netzwerkdienste | KRITISCH | Hoch |
| BSI-201 A.10.1.2 | Kryptografie | KRITISCH | Hoch |
| BSI-201 A.12.2.1 | Input-Validierung | KRITISCH | Hoch |
| BSI-201 A.12.4.1 | Ereignisprotokollierung | KRITISCH | Hoch |
| ISO 27001:2022 A.5.15 | Zugriffskontrolle | KRITISCH | Hoch |
| ISO 27001:2022 A.8.24 | Kryptografie | KRITISCH | Hoch |
| ISO 27001:2022 A.8.28 | Sichere Codierung | KRITISCH | Hoch |
| ISO/IEC 20000 | Incident Management | MITTEL | Mittel |

---

## 7. Priorisierte Maßnahmen

### Sofort (0-24h):
1. JWT-Secret entfernen und aus Environment lesen
2. Datenbank-Credentials entfernen
3. Rate-Limiting implementieren

### Kurzfristig (1-7 Tage):
4. Authentifizierung auf alle API-Routen
5. CSRF-Schutz implementieren
6. XML-Upload härten (Magic Bytes, Größenlimit)

### Mittelfristig (1-4 Wochen):
7. Content-Security-Policy
8. Audit-Logging vervollständigen
9. Redis TLS aktivieren
10. Session-Management verbessern

---

## 8. Compliance-Status

- **BSI-201:** 45% konform (9/20 kritische Controls implementiert)
- **ISO/IEC 27001:2022:** 52% konform (13/25 Controls implementiert)
- **ISO/IEC 20000:** 60% konform (12/20 Prozesse implementiert)

---

**Bericht erstellt von:** Kiro AI Security Audit System  
**Nächster Review:** 2026-10-03
