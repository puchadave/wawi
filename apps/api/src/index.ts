import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { client, db } from './db.js';
import { parseMatterhornXmlStream } from './xmlParser.js';
import { upsertProduct } from './importer.js';
import { products } from './schema.js';
import { pricingRoutes } from './routes/pricing.js';
import { productRoutes } from './routes/products.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { matterhornRoutes } from './routes/matterhorn.js';
import { aiRoutes } from './routes/ai.js';
import { integrationsRoutes } from './routes/integrations.js';
import { shopwareRoutes } from './routes/shopware.js';
import { bootstrapAdmin } from './auth/bootstrap.js';
import { redisConnection, stockQueue, priceQueue, syncQueue, mediaQueue, feeQueue, syncWorker, mediaWorker, feeWorker } from './queues.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const server = Fastify({
  logger: true,
  trustProxy: true,
});

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
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  noSniff: true,
  xssFilter: true,
});

await server.register(cookie, {
  hook: 'onRequest',
  parseOptions: {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  },
});

await server.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  keyGenerator: (request) => {
    return request.headers['x-forwarded-for']?.toString() ||
           request.headers['x-real-ip']?.toString() ||
           request.ip;
  },
});

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
  credentials: true,
});

await server.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1,
    fields: 0,
  },
});

await server.register(authRoutes);
await server.register(adminRoutes);
await server.register(pricingRoutes);
await server.register(productRoutes);
await server.register(matterhornRoutes);
await server.register(integrationsRoutes);
await server.register(shopwareRoutes);
await server.register(aiRoutes);

// --- tracing: x-request-id echo + duration log (kontinuierliches Debugging) ---
server.addHook('onRequest', async (request, reply) => {
  const rid = (request.headers['x-request-id'] as string) || randomUUID();
  (request as any)._rid = rid;
  (request as any)._t0 = Date.now();
  reply.header('x-request-id', rid);
});
server.addHook('onResponse', async (request, reply) => {
  const t0 = (request as any)._t0 as number | undefined;
  const rid = (request as any)._rid as string | undefined;
  const ms = t0 ? Date.now() - t0 : undefined;
  server.log.info({ method: request.method, url: request.url, statusCode: reply.statusCode, durationMs: ms, requestId: rid }, 'request');
});

// --- health (informativ, ohne Auth) + readiness (200 nur wenn DB+Redis ok) ---
server.get('/health', async (_req, reply) => {
  const started = Date.now();
  let db: 'connected' | 'disconnected' = 'disconnected';
  let redis: 'connected' | 'disconnected' = 'disconnected';
  let dbMs: number | undefined;
  let redisMs: number | undefined;
  let queues: Record<string, unknown> | undefined;
  const tDb0 = Date.now();
  try { await client`SELECT 1`; db = 'connected'; dbMs = Date.now() - tDb0; } catch (e) { server.log.warn({ err: e }, 'health: db check failed'); dbMs = Date.now() - tDb0; }
  const tR0 = Date.now();
  try { await redisConnection.ping(); redis = 'connected'; redisMs = Date.now() - tR0; } catch (e) { server.log.warn({ err: e }, 'health: redis ping failed'); redisMs = Date.now() - tR0; }
  try {
    const [sync, stock, price] = await Promise.all([
      syncQueue.getJobCounts().catch(() => null),
      stockQueue.getJobCounts().catch(() => null),
      priceQueue.getJobCounts().catch(() => null),
    ]);
    queues = { sync, stock, price };
  } catch { /* best-effort */ }
  const status = db === 'connected' && redis === 'connected' ? 'ok' : 'degraded';
  reply.header('x-request-id', (_req.headers['x-request-id'] as string) || '');
  return { status, db, redis, dbMs, redisMs, queues, uptimeSec: Math.round(process.uptime()), version: process.env.npm_package_version || '0.7.0', timestamp: new Date().toISOString(), durationMs: Date.now() - started };
});

server.get('/ready', async (_req, reply) => {
  try {
    await client`SELECT 1`;
    await redisConnection.ping();
    return { status: 'ready', db: 'connected', redis: 'connected', timestamp: new Date().toISOString() };
  } catch (err) {
    server.log.warn({ err }, 'readiness failed');
    return reply.status(503).send({ status: 'not-ready', error: (err as Error).message, timestamp: new Date().toISOString() });
  }
});

const ALLOWED_MIME_TYPES = ['application/xml', 'text/xml'];
const ALLOWED_EXTENSIONS = ['.xml'];

server.post('/api/import/upload', async (request, reply) => {
  const data = await request.file();
  if (!data) {
    return reply.status(400).send({ error: 'Keine Datei hochgeladen' });
  }

  if (!ALLOWED_MIME_TYPES.includes(data.mimetype || '')) {
    return reply.status(415).send({ error: 'Nur XML-Dateien erlaubt' });
  }

  const filename = data.filename || '';
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return reply.status(415).send({ error: 'Ungültige Dateiendung' });
  }

  const tmpPath = path.resolve(__dirname, `../tmp_upload_${Date.now()}.xml`);
  const resolvedPath = path.resolve(tmpPath);
  if (!resolvedPath.startsWith(path.resolve(__dirname, '../'))) {
    return reply.status(400).send({ error: 'Ungültiger Dateipfad' });
  }

  const writeStream = fs.createWriteStream(tmpPath);
  await new Promise<void>((resolve, reject) => {
    data.file.pipe(writeStream);
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
    data.file.on('error', reject);
  });

  let importedCount = 0;

  try {
    await parseMatterhornXmlStream(tmpPath, async (product) => {
      importedCount++;
      await upsertProduct(product, true);
    });

    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }

    return reply.send({
      message: 'Manueller Whitelist-Import erfolgreich abgeschlossen',
      importedCount,
    });
  } catch (err: any) {
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
    server.log.error(err, 'Fehler beim manuellen XML-Upload');
    return reply.status(500).send({ error: 'Import fehlgeschlagen', details: err.message });
  }
});

const start = async () => {
  try {
    console.log('🔧 Running bootstrap (admin, roles, permissions)...');
    await bootstrapAdmin();

    const port = Number(process.env.PORT) || 3000;
    const host = process.env.HOST || '0.0.0.0';
    await server.listen({ port, host });
    console.log(`🚀 API Running on http://${host}:${port}`);
    console.log('BullMQ workers started.');
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
