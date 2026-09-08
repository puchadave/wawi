import { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { matterhornConnections, importJobs, importLogs, products } from '../schema.js';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, requirePermission } from '../auth/middleware.js';
import { logAudit } from '../auth/audit.js';
import { parseMatterhornXmlStream } from '../xmlParser.js';
import { upsertProduct } from '../importer.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const createConnectionSchema = z.object({
  name: z.string().trim().min(2).max(100),
  type: z.enum(['xml', 'csv', 'json', 'api', 'ftp', 'sftp', 'matterhorn']).default('xml'),
  endpoint: z.string().trim().max(2000).optional().nullable(),
  auth: z.record(z.string(), z.string()).optional().default({}),
  mapping: z.record(z.string(), z.string()).optional().default({}),
  schedule: z.string().trim().max(100).optional().nullable(),
  isEnabled: z.boolean().optional().default(true),
});

const updateConnectionSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  type: z.enum(['xml', 'csv', 'json', 'api', 'ftp', 'sftp', 'matterhorn']).optional(),
  endpoint: z.string().trim().max(2000).optional().nullable(),
  auth: z.record(z.string(), z.string()).optional(),
  mapping: z.record(z.string(), z.string()).optional(),
  schedule: z.string().trim().max(100).optional().nullable(),
  isEnabled: z.boolean().optional(),
});

async function testEndpoint(endpoint: string, auth: Record<string, string>): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  if (!endpoint) return { ok: false, latencyMs: 0, message: 'Kein Endpoint konfiguriert' };
  const start = Date.now();
  try {
    const headers: Record<string, string> = {};
    if (auth.apiKey) headers['x-api-key'] = auth.apiKey;
    if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
    if (auth.username && auth.password) {
      headers['Authorization'] = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(endpoint, { method: 'HEAD', headers, signal: controller.signal });
    clearTimeout(timeout);
    let ok = res.ok;
    let message = `${res.status} ${res.statusText}`;
    if (!ok && res.status === 405) {
      // HEAD not allowed -> retry GET with range 0-0
      const c2 = new AbortController();
      const t2 = setTimeout(() => c2.abort(), 8000);
      const res2 = await fetch(endpoint, { method: 'GET', headers: { ...headers, Range: 'bytes=0-0' }, signal: c2.signal });
      clearTimeout(t2);
      ok = res2.ok || res2.status === 206;
      message = `${res2.status} ${res2.statusText} (fallback GET)`;
    }
    return { ok, latencyMs: Date.now() - start, message };
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, message: err.message || String(err) };
  }
}

export async function matterhornRoutes(server: FastifyInstance) {
  // --- Connections CRUD ---
  server.get('/api/admin/matterhorn/connections', {
    preHandler: [authenticate, requirePermission('import:read')],
  }, async () => {
    const rows = await db.select().from(matterhornConnections).orderBy(matterhornConnections.name);
    return { connections: rows };
  });

  server.post('/api/admin/matterhorn/connections', {
    preHandler: [authenticate, requirePermission('import:write')],
  }, async (request, reply) => {
    const parsed = createConnectionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Ungültige Verbindungsdaten', details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const existing = await db.select().from(matterhornConnections).where(eq(matterhornConnections.name, data.name)).limit(1);
    if (existing.length) return reply.status(409).send({ error: `Verbindung "${data.name}" existiert bereits` });

    const row = {
      id: uuidv4(),
      name: data.name,
      type: data.type,
      endpoint: data.endpoint || null,
      auth: data.auth || {},
      mapping: data.mapping || {},
      schedule: data.schedule || null,
      isEnabled: data.isEnabled ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(matterhornConnections).values(row as any);
    await logAudit({ userId: (request as any).user?.sub, action: 'matterhorn_connection_created', entity: 'matterhorn_connection', entityId: row.id, newValue: { name: row.name, type: row.type }, ipAddress: request.ip, userAgent: request.headers['user-agent']?.toString(), success: true });
    return reply.code(201).send({ connection: row });
  });

  server.get('/api/admin/matterhorn/connections/:id', {
    preHandler: [authenticate, requirePermission('import:read')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await db.select().from(matterhornConnections).where(eq(matterhornConnections.id, id)).limit(1);
    if (!row.length) return reply.status(404).send({ error: 'Verbindung nicht gefunden' });
    return { connection: row[0] };
  });

  server.patch('/api/admin/matterhorn/connections/:id', {
    preHandler: [authenticate, requirePermission('import:write')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateConnectionSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Ungültige Daten', details: parsed.error.flatten() });
    const current = await db.select().from(matterhornConnections).where(eq(matterhornConnections.id, id)).limit(1);
    if (!current.length) return reply.status(404).send({ error: 'Verbindung nicht gefunden' });
    if (parsed.data.name && parsed.data.name !== current[0].name) {
      const dup = await db.select().from(matterhornConnections).where(eq(matterhornConnections.name, parsed.data.name)).limit(1);
      if (dup.length) return reply.status(409).send({ error: `Verbindung "${parsed.data.name}" existiert bereits` });
    }
    const updates: any = { updatedAt: new Date() };
    for (const k of ['name', 'type', 'endpoint', 'auth', 'mapping', 'schedule', 'isEnabled'] as const) {
      if ((parsed.data as any)[k] !== undefined) updates[k] = (parsed.data as any)[k];
    }
    await db.update(matterhornConnections).set(updates).where(eq(matterhornConnections.id, id));
    const updated = await db.select().from(matterhornConnections).where(eq(matterhornConnections.id, id)).limit(1);
    await logAudit({ userId: (request as any).user?.sub, action: 'matterhorn_connection_updated', entity: 'matterhorn_connection', entityId: id, newValue: updates, ipAddress: request.ip, userAgent: request.headers['user-agent']?.toString(), success: true });
    return { connection: updated[0] };
  });

  server.delete('/api/admin/matterhorn/connections/:id', {
    preHandler: [authenticate, requirePermission('import:write')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await db.select().from(matterhornConnections).where(eq(matterhornConnections.id, id)).limit(1);
    if (!row.length) return reply.status(404).send({ error: 'Verbindung nicht gefunden' });
    await db.delete(matterhornConnections).where(eq(matterhornConnections.id, id));
    await logAudit({ userId: (request as any).user?.sub, action: 'matterhorn_connection_deleted', entity: 'matterhorn_connection', entityId: id, ipAddress: request.ip, userAgent: request.headers['user-agent']?.toString(), success: true });
    return { ok: true };
  });

  server.post('/api/admin/matterhorn/connections/:id/test', {
    preHandler: [authenticate, requirePermission('import:write')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await db.select().from(matterhornConnections).where(eq(matterhornConnections.id, id)).limit(1);
    if (!row.length) return reply.status(404).send({ error: 'Verbindung nicht gefunden' });
    const conn = row[0];
    const result = await testEndpoint(conn.endpoint || '', (conn.auth as any) || {});
    await db.update(matterhornConnections).set({ lastTestedAt: new Date(), lastTestResult: result, updatedAt: new Date() } as any).where(eq(matterhornConnections.id, id));
    return { result, connectionId: id };
  });

  // --- Trigger import for a connection (multipart XML upload) ---
  server.post('/api/admin/matterhorn/connections/:id/import', {
    preHandler: [authenticate, requirePermission('import:write')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const conn = await db.select().from(matterhornConnections).where(eq(matterhornConnections.id, id)).limit(1);
    if (!conn.length) return reply.status(404).send({ error: 'Verbindung nicht gefunden' });
    if (conn[0].type !== 'xml' && conn[0].type !== 'matterhorn') {
      return reply.status(400).send({ error: `Import für Typ "${conn[0].type}" noch nicht implementiert (nur xml/matterhorn in P0)` });
    }

    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'Keine Datei hochgeladen' });
    const allowedMime = ['application/xml', 'text/xml', 'application/octet-stream'];
    const filename = data.filename || 'upload.xml';
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    if (!allowedMime.includes(data.mimetype || '') && ext !== '.xml') {
      return reply.status(415).send({ error: 'Nur XML-Dateien erlaubt' });
    }

    const tmpPath = path.resolve(__dirname, `../tmp_matterhorn_${Date.now()}_${id}.xml`);
    const writeStream = fs.createWriteStream(tmpPath);
    await new Promise<void>((resolve, reject) => {
      data.file.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      data.file.on('error', reject);
    });

    const jobId = uuidv4();
    await db.insert(importJobs).values({
      id: jobId,
      connectionId: id,
      status: 'running',
      startedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    let totalParsed = 0;
    let importedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    const log = async (level: 'info' | 'warn' | 'error', message: string, details?: Record<string, unknown>) => {
      await db.insert(importLogs).values({ id: uuidv4(), jobId, level, message, details: details || null } as any);
    };

    await log('info', `Import gestartet für Verbindung "${conn[0].name}"`, { filename });

    try {
      const result = await parseMatterhornXmlStream(tmpPath, async (product) => {
        totalParsed++;
        try {
          // zod-like validation via importer: require id, name; importer handles whitelist
          if (!product.id || !String(product.id).trim()) {
            failedCount++;
            await log('error', `Produkt ohne ID übersprungen`, { product });
            return;
          }
          const before = totalParsed;
          await upsertProduct(product as any, true);
          // Heuristic: if upsert skipped due to whitelist, importer would have returned without insert
          // We count as imported; skipped is tracked separately via importer return value if extended later
          importedCount++;
        } catch (e: any) {
          failedCount++;
          await log('error', `Fehler bei Produkt ${String(product.id)}`, { error: e.message });
        }
      });

      // totalParsed already counted; result.totalParsed may differ if parser counts internally
      if (result.totalParsed && result.totalParsed !== totalParsed) totalParsed = result.totalParsed;

      await db.update(importJobs).set({
        status: 'completed',
        totalProducts: totalParsed,
        importedCount,
        skippedCount,
        failedCount,
        completedAt: new Date(),
        updatedAt: new Date(),
      } as any).where(eq(importJobs.id, jobId));

      await log('info', `Import abgeschlossen: ${importedCount} importiert, ${failedCount} fehlgeschlagen`, { totalParsed, importedCount, failedCount });
      await logAudit({ userId: (request as any).user?.sub, action: 'matterhorn_import_completed', entity: 'import_job', entityId: jobId, newValue: { connectionId: id, totalParsed, importedCount, failedCount }, ipAddress: request.ip, userAgent: request.headers['user-agent']?.toString(), success: true });

      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      return reply.send({ jobId, status: 'completed', totalParsed, importedCount, failedCount });
    } catch (err: any) {
      await db.update(importJobs).set({
        status: 'failed',
        totalProducts: totalParsed,
        importedCount,
        failedCount,
        error: err.message || String(err),
        completedAt: new Date(),
        updatedAt: new Date(),
      } as any).where(eq(importJobs.id, jobId));
      await log('error', `Import fehlgeschlagen: ${err.message}`, { error: err.stack });
      if (fs.existsSync(tmpPath)) try { fs.unlinkSync(tmpPath); } catch {}
      return reply.status(500).send({ error: 'Import fehlgeschlagen', details: err.message, jobId });
    }
  });

  // --- Jobs & Logs ---
  server.get('/api/admin/matterhorn/jobs', {
    preHandler: [authenticate, requirePermission('import:read')],
  }, async (request) => {
    const query = request.query as { connectionId?: string; limit?: string };
    const limit = Math.min(Math.max(parseInt(query.limit || '50', 10) || 50, 1), 200);
    const rows = query.connectionId
      ? await db.select().from(importJobs).where(eq(importJobs.connectionId, query.connectionId)).orderBy(desc(importJobs.createdAt)).limit(limit)
      : await db.select().from(importJobs).orderBy(desc(importJobs.createdAt)).limit(limit);
    return { jobs: rows };
  });

  server.get('/api/admin/matterhorn/jobs/:id', {
    preHandler: [authenticate, requirePermission('import:read')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await db.select().from(importJobs).where(eq(importJobs.id, id)).limit(1);
    if (!job.length) return reply.status(404).send({ error: 'Job nicht gefunden' });
    const logs = await db.select().from(importLogs).where(eq(importLogs.jobId, id)).orderBy(importLogs.createdAt);
    return { job: job[0], logs };
  });

  server.get('/api/admin/matterhorn/jobs/:id/logs', {
    preHandler: [authenticate, requirePermission('import:read')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await db.select().from(importJobs).where(eq(importJobs.id, id)).limit(1);
    if (!job.length) return reply.status(404).send({ error: 'Job nicht gefunden' });
    const logs = await db.select().from(importLogs).where(eq(importLogs.jobId, id)).orderBy(importLogs.createdAt);
    return { logs };
  });
}
