import { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { products, shopwareMappings, syncAttempts, variants } from '../schema.js';
import { SQL, and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { syncQueue } from '../queues.js';
import { logAudit } from '../auth/audit.js';

const productQuerySchema = z.object({
  status: z.enum(['imported', 'reviewed', 'approved', 'synced', 'rejected']).optional(),
  brand: z.string().trim().min(1).max(100).optional(),
  categoryId: z.string().trim().min(1).max(50).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const manualDataSchema = z.object({
  title: z.string().max(500).optional(),
  description: z.string().max(100000).optional(),
  metaTitle: z.string().max(60).optional(),
  metaDescription: z.string().max(160).optional(),
});

async function updateStatus(id: string, status: 'reviewed' | 'approved' | 'rejected', userId?: string, ip?: string, userAgent?: string) {
  const updated = await db.update(products)
    .set({ status, updatedAt: new Date() })
    .where(eq(products.supplierProductId, id))
    .returning({ id: products.supplierProductId });

  if (updated.length > 0 && userId) {
    await logAudit({
      userId,
      action: `product_status_${status}`,
      entity: 'product',
      entityId: id,
      ipAddress: ip,
      userAgent,
      success: true,
    });
  }

  return updated.length > 0;
}

function sanitizeSearch(input: string): string {
  return input.replace(/[%_\\]/g, '\\$&').substring(0, 100);
}

export async function productRoutes(server: FastifyInstance) {
  server.get('/api/products', async (request, reply) => {
    const parsed = productQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
    }

    const { status, brand, categoryId, search, limit, offset } = parsed.data;
    const conditions: SQL[] = [];
    if (status) conditions.push(eq(products.status, status));
    if (brand) conditions.push(eq(products.brand, brand));
    if (categoryId) conditions.push(eq(products.categoryId, categoryId));
    if (search) {
      const sanitized = sanitizeSearch(search);
      const searchCondition = or(
        ilike(products.name, `%${sanitized}%`), 
        ilike(products.brand, `%${sanitized}%`)
      );
      if (searchCondition) conditions.push(searchCondition);
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [result, countResult] = await Promise.all([
      db.select()
        .from(products)
        .where(where)
        .orderBy(desc(products.updatedAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(where),
    ]);

    return reply.send({ products: result, count: countResult[0]?.count ?? 0, limit, offset });
  });

  server.get('/api/products/review', async (request, reply) => {
    const parsed = productQuerySchema.pick({ limit: true, offset: true }).safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
    }

    const { limit, offset } = parsed.data;
    const reviewCondition = or(eq(products.status, 'imported'), eq(products.status, 'reviewed'));
    const [result, countResult] = await Promise.all([
      db.select()
        .from(products)
        .where(reviewCondition)
        .orderBy(desc(products.updatedAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(reviewCondition),
    ]);

    return reply.send({ products: result, count: countResult[0]?.count ?? 0, limit, offset });
  });

  server.get('/api/products/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || id.length > 100) {
      return reply.status(400).send({ error: 'Invalid product ID format' });
    }
    
    const [result, productVariants] = await Promise.all([
      db.select().from(products).where(eq(products.supplierProductId, id)).limit(1),
      db.select().from(variants).where(eq(variants.supplierProductId, id)),
    ]);

    if (!result.length) {
      return reply.status(404).send({ error: 'Product not found' });
    }

    const [latestAttempt, productMapping] = await Promise.all([
      db.select().from(syncAttempts).where(eq(syncAttempts.supplierProductId, id)).orderBy(desc(syncAttempts.createdAt)).limit(1),
      db.select().from(shopwareMappings).where(and(eq(shopwareMappings.supplierProductId, id), eq(shopwareMappings.entityType, 'product'))).limit(1),
    ]);

    return reply.send({ ...result[0], variants: productVariants, syncAttempt: latestAttempt[0] || null, shopwareMapping: productMapping[0] || null });
  });

  server.patch('/api/products/:id/manual-data', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = manualDataSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid manual data', details: parsed.error.flatten() });
    }

    const updated = await db.update(products)
      .set({ manualData: parsed.data, updatedAt: new Date() })
      .where(eq(products.supplierProductId, id))
      .returning();

    if (!updated.length) {
      return reply.status(404).send({ error: 'Product not found' });
    }

    await logAudit({
      userId: (request as any).user?.sub,
      action: 'product_manual_data_updated',
      entity: 'product',
      entityId: id,
      newValue: parsed.data,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      success: true,
    });

    return reply.send(updated[0]);
  });

  server.post('/api/products/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!await updateStatus(id, 'approved', (request as any).user?.sub, request.ip, request.headers['user-agent']?.toString())) {
      return reply.status(404).send({ error: 'Product not found' });
    }
    return reply.send({ status: 'approved', id });
  });

  server.post('/api/products/:id/sync', async (request, reply) => {
    const { id } = request.params as { id: string };
    const product = await db.select({ id: products.supplierProductId, status: products.status })
      .from(products)
      .where(eq(products.supplierProductId, id))
      .limit(1);

    if (!product.length) return reply.status(404).send({ error: 'Product not found' });
    if (product[0].status !== 'approved' && product[0].status !== 'synced') {
      return reply.status(409).send({ error: 'Product must be approved before sync' });
    }

    const attemptId = uuidv4();
    await db.insert(syncAttempts).values({
      id: attemptId,
      supplierProductId: id,
      status: 'queued',
      updatedAt: new Date(),
    });

    try {
      const job = await syncQueue.add('sync-product', { supplierProductId: id, attemptId }, { jobId: `product-${id}-${attemptId}` });
      await db.update(syncAttempts)
        .set({ jobId: String(job.id), updatedAt: new Date() })
        .where(eq(syncAttempts.id, attemptId));
      
      await logAudit({
        userId: (request as any).user?.sub,
        action: 'product_sync_queued',
        entity: 'product',
        entityId: id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        success: true,
      });
      
      return reply.status(202).send({ status: 'queued', id, attemptId, jobId: job.id });
    } catch (error) {
      await db.update(syncAttempts)
        .set({ status: 'failed', error: error instanceof Error ? error.message : String(error), completedAt: new Date(), updatedAt: new Date() })
        .where(eq(syncAttempts.id, attemptId));
      throw error;
    }
  });

  server.post('/api/products/:id/reject', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!await updateStatus(id, 'rejected', (request as any).user?.sub, request.ip, request.headers['user-agent']?.toString())) {
      return reply.status(404).send({ error: 'Product not found' });
    }
    return reply.send({ status: 'rejected', id });
  });

  server.post('/api/products/:id/review', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!await updateStatus(id, 'reviewed', (request as any).user?.sub, request.ip, request.headers['user-agent']?.toString())) {
      return reply.status(404).send({ error: 'Product not found' });
    }
    return reply.send({ status: 'reviewed', id });
  });

  server.post('/api/products/bulk-approve', async (request, reply) => {
    const parsed = z.object({ ids: z.array(z.string().min(1).max(100)).min(1).max(100) }).safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid product IDs', details: parsed.error.flatten() });
    }

    const invalidIds = parsed.data.ids.filter(id => !/^[a-zA-Z0-9_-]+$/.test(id) || id.length > 100);
    if (invalidIds.length > 0) {
      return reply.status(400).send({ error: 'Invalid ID format', invalidIds });
    }

    const updated = await db.update(products)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(inArray(products.supplierProductId, parsed.data.ids))
      .returning({ id: products.supplierProductId });

    await logAudit({
      userId: (request as any).user?.sub,
      action: 'products_bulk_approved',
      entity: 'product',
      newValue: { count: updated.length, ids: parsed.data.ids },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      success: true,
    });

    return reply.send({ status: 'approved', count: updated.length });
  });
}