import { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { products, shopwareMappings, syncAttempts, variants } from '../schema.js';
import { SQL, and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { syncQueue } from '../queues.js';

const productQuerySchema = z.object({
  status: z.enum(['imported', 'reviewed', 'approved', 'synced', 'rejected']).optional(),
  brand: z.string().trim().min(1).optional(),
  categoryId: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const manualDataSchema = z.object({
  title: z.string().max(500).optional(),
  description: z.string().max(100000).optional(),
  metaTitle: z.string().max(60).optional(),
  metaDescription: z.string().max(160).optional(),
});

async function updateStatus(id: string, status: 'reviewed' | 'approved' | 'rejected') {
  const updated = await db.update(products)
    .set({ status, updatedAt: new Date() })
    .where(eq(products.supplierProductId, id))
    .returning({ id: products.supplierProductId });

  return updated.length > 0;
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
      const searchCondition = or(ilike(products.name, `%${search}%`), ilike(products.brand, `%${search}%`));
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

    return reply.send(updated[0]);
  });

  server.post('/api/products/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!await updateStatus(id, 'approved')) {
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
    if (!await updateStatus(id, 'rejected')) {
      return reply.status(404).send({ error: 'Product not found' });
    }
    return reply.send({ status: 'rejected', id });
  });

  server.post('/api/products/:id/review', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!await updateStatus(id, 'reviewed')) {
      return reply.status(404).send({ error: 'Product not found' });
    }
    return reply.send({ status: 'reviewed', id });
  });

  server.post('/api/products/bulk-approve', async (request, reply) => {
    const parsed = z.object({ ids: z.array(z.string().min(1)).min(1).max(100) }).safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid product IDs', details: parsed.error.flatten() });
    }

    const updated = await db.update(products)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(inArray(products.supplierProductId, parsed.data.ids))
      .returning({ id: products.supplierProductId });

    return reply.send({ status: 'approved', count: updated.length });
  });
}
