import { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { integrations, shopwareMappings, syncAttempts, products } from '../schema.js';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { authenticate, requirePermission } from '../auth/middleware.js';
import { logAudit } from '../auth/audit.js';
import { syncQueue } from '../queues.js';
import { ShopwareClient } from '../shopware/client.js';

const mappingsQuerySchema = z.object({
  supplierProductId: z.string().trim().min(1).max(100).optional(),
  entityType: z.string().trim().min(1).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const attemptsQuerySchema = z.object({
  supplierProductId: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function shopwareRoutes(server: FastifyInstance) {
  // --- Status: env ShopwareClient + shopware integrations + queue counts ---
  server.get('/api/admin/shopware/status', {
    preHandler: [authenticate, requirePermission('shopware:read')],
  }, async () => {
    const client = new ShopwareClient();
    const isConfigured = client.isConfigured();
    const shopwareIntegrations = await db.select().from(integrations).where(eq(integrations.type, 'shopware')).orderBy(integrations.name);
    // Mask credentials same as integrations route
    const masked = shopwareIntegrations.map((row) => {
      const creds = (row.credentials as Record<string, string>) || {};
      const maskedCreds: Record<string, string> = {};
      for (const [k, v] of Object.entries(creds)) {
        if (!v) maskedCreds[k] = '';
        else if (v.length <= 4) maskedCreds[k] = '****';
        else maskedCreds[k] = '****' + v.slice(-4);
      }
      return { ...row, credentials: maskedCreds };
    });

    let queueCounts: Record<string, number> | null = null;
    let queueError: string | null = null;
    try {
      queueCounts = await syncQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    } catch (err: any) {
      queueError = err.message || String(err);
    }

    // Aggregate sync stats
    const recentAttempts = await db.select().from(syncAttempts).orderBy(desc(syncAttempts.createdAt)).limit(10);
    const mappingsCountResult = await db.select().from(shopwareMappings).limit(1);
    // Use simple counts via JS: total mappings count requires sql count; do rough len via select length for small
    // Better: raw count query
    let mappingsTotal = 0;
    let attemptsTotal = 0;
    try {
      const mc = await db.select().from(shopwareMappings);
      mappingsTotal = mc.length;
      const ac = await db.select().from(syncAttempts);
      attemptsTotal = ac.length;
    } catch {
      // fallback to 0
    }

    return {
      envConfigured: isConfigured,
      integrations: masked,
      queue: queueCounts,
      queueError,
      stats: {
        mappingsTotal,
        attemptsTotal,
        recentAttempts,
      },
    };
  });

  // --- Mappings Historie ---
  server.get('/api/admin/shopware/mappings', {
    preHandler: [authenticate, requirePermission('shopware:read')],
  }, async (request) => {
    const parsed = mappingsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return { error: 'Invalid query', details: parsed.error.flatten() };
    }
    const { supplierProductId, entityType, limit, offset } = parsed.data;
    let rows = await db.select().from(shopwareMappings).orderBy(desc(shopwareMappings.syncedAt));
    if (supplierProductId) rows = rows.filter(r => r.supplierProductId === supplierProductId);
    if (entityType) rows = rows.filter(r => (r as any).entityType === entityType);
    const total = rows.length;
    const paged = rows.slice(offset, offset + limit);
    // Enrich with product name if available
    const productIds = [...new Set(paged.map(r => r.supplierProductId))];
    const productsMap = new Map<string, string>();
    if (productIds.length) {
      const prodRows = await db.select({ id: products.supplierProductId, name: products.name }).from(products).where(eq(products.supplierProductId, productIds[0] as any));
      // drizzle inArray for multiple
      const { inArray } = await import('drizzle-orm');
      const all = await db.select({ id: products.supplierProductId, name: products.name }).from(products).where(inArray(products.supplierProductId, productIds));
      for (const pr of all) productsMap.set(pr.id, (pr as any).name);
    }
    const enriched = paged.map(r => ({ ...r, productName: productsMap.get(r.supplierProductId) || null }));
    return { mappings: enriched, total, limit, offset };
  });

  // --- Sync Attempts Historie ---
  server.get('/api/admin/shopware/attempts', {
    preHandler: [authenticate, requirePermission('shopware:read')],
  }, async (request) => {
    const parsed = attemptsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return { error: 'Invalid query', details: parsed.error.flatten() };
    }
    const { supplierProductId, status, limit, offset } = parsed.data;
    let rows = await db.select().from(syncAttempts).orderBy(desc(syncAttempts.createdAt));
    if (supplierProductId) rows = rows.filter(r => r.supplierProductId === supplierProductId);
    if (status) rows = rows.filter(r => r.status === status);
    const total = rows.length;
    const paged = rows.slice(offset, offset + limit);
    return { attempts: paged, total, limit, offset };
  });

  // --- Queue Detail ---
  server.get('/api/admin/shopware/queue', {
    preHandler: [authenticate, requirePermission('shopware:read')],
  }, async (_request, reply) => {
    try {
      const counts = await syncQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
      // Fetch a sample of waiting/active jobs
      const waiting = await syncQueue.getJobs(['waiting'], 0, 9);
      const active = await syncQueue.getJobs(['active'], 0, 9);
      const failed = await syncQueue.getJobs(['failed'], 0, 9);
      const sample = {
        waiting: waiting.map(j => ({ id: j.id, name: j.name, data: j.data, attemptsMade: j.attemptsMade, timestamp: j.timestamp })),
        active: active.map(j => ({ id: j.id, name: j.name, data: j.data, attemptsMade: j.attemptsMade, timestamp: j.timestamp })),
        failed: failed.map(j => ({ id: j.id, name: j.name, data: j.data, attemptsMade: j.attemptsMade, failedReason: j.failedReason, timestamp: j.timestamp })),
      };
      return { counts, sample };
    } catch (err: any) {
      return reply.status(503).send({ error: 'Queue nicht erreichbar', message: err.message || String(err) });
    }
  });

  // --- Retry via shopware namespace (alternative to products retry) ---
  server.post('/api/admin/shopware/retry/:supplierProductId', {
    preHandler: [authenticate, requirePermission('shopware:write')],
  }, async (request, reply) => {
    const { supplierProductId } = request.params as { supplierProductId: string };
    if (!supplierProductId || !/^[a-zA-Z0-9_-]+$/.test(supplierProductId) || supplierProductId.length > 100) {
      return reply.status(400).send({ error: 'Ungueltige supplierProductId' });
    }
    const productRows = await db.select({ id: products.supplierProductId, status: products.status }).from(products).where(eq(products.supplierProductId, supplierProductId)).limit(1);
    if (!productRows.length) return reply.status(404).send({ error: 'Product nicht gefunden' });

    // Find last failed attempt
    const attempts = await db.select().from(syncAttempts).where(eq(syncAttempts.supplierProductId, supplierProductId)).orderBy(desc(syncAttempts.createdAt)).limit(5);
    const lastFailed = attempts.find(a => a.status === 'failed');
    // Allow retry even if no failed, if product is approved/synced
    if (productRows[0].status !== 'approved' && productRows[0].status !== 'synced' && !lastFailed) {
      return reply.status(409).send({ error: 'Product muss approved/synced sein oder einen fehlgeschlagenen Versuch haben' });
    }

    const attemptId = uuidv4();
    await db.insert(syncAttempts).values({
      id: attemptId,
      supplierProductId,
      status: 'queued',
      updatedAt: new Date(),
    });

    try {
      const job = await syncQueue.add('sync-product', { supplierProductId, attemptId }, { jobId: `product-${supplierProductId}-${attemptId}` });
      await db.update(syncAttempts).set({ jobId: String(job.id), updatedAt: new Date() }).where(eq(syncAttempts.id, attemptId));
      await logAudit({
        userId: (request as any).user?.sub,
        action: 'shopware_retry_queued',
        entity: 'product',
        entityId: supplierProductId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent']?.toString(),
        success: true,
      });
      return reply.status(202).send({ status: 'queued', supplierProductId, attemptId, jobId: job.id });
    } catch (error: any) {
      await db.update(syncAttempts).set({ status: 'failed', error: error.message || String(error), completedAt: new Date(), updatedAt: new Date() }).where(eq(syncAttempts.id, attemptId));
      throw error;
    }
  });
}
