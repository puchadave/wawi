import { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { integrations } from '../schema.js';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, requirePermission } from '../auth/middleware.js';
import { logAudit } from '../auth/audit.js';

const createIntegrationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  type: z.enum(['ai', 'matterhorn', 'shopware', 'marketplace', 'custom']).default('custom'),
  endpoint: z.string().trim().max(2000).optional().nullable(),
  credentials: z.record(z.string(), z.string()).optional().default({}),
  isEnabled: z.boolean().optional().default(true),
});

const updateIntegrationSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  type: z.enum(['ai', 'matterhorn', 'shopware', 'marketplace', 'custom']).optional(),
  endpoint: z.string().trim().max(2000).optional().nullable(),
  credentials: z.record(z.string(), z.string()).optional(),
  isEnabled: z.boolean().optional(),
});

function maskCredentials(creds: Record<string, string> | null | undefined): Record<string, string> {
  if (!creds || typeof creds !== 'object') return {};
  const masked: Record<string, string> = {};
  for (const [k, v] of Object.entries(creds)) {
    if (!v) { masked[k] = ''; continue; }
    // Show only last 4 chars, rest masked
    if (v.length <= 4) masked[k] = '****';
    else masked[k] = '****' + v.slice(-4);
  }
  return masked;
}

function maskIntegration(row: typeof integrations.$inferSelect) {
  return {
    ...row,
    credentials: maskCredentials(row.credentials as Record<string, string>),
  };
}

async function testEndpoint(endpoint: string, credentials: Record<string, string>): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  if (!endpoint) return { ok: false, latencyMs: 0, message: 'Kein Endpoint konfiguriert' };
  const start = Date.now();
  try {
    const headers: Record<string, string> = {};
    if (credentials.apiKey) headers['x-api-key'] = credentials.apiKey;
    if (credentials.token) headers['Authorization'] = `Bearer ${credentials.token}`;
    if (credentials.bearer) headers['Authorization'] = `Bearer ${credentials.bearer}`;
    if (credentials.username && credentials.password) {
      headers['Authorization'] = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`;
    }
    // Shopware client test: if credentials contain clientId/clientSecret, try OAuth token endpoint
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(endpoint, { method: 'HEAD', headers, signal: controller.signal });
    clearTimeout(timeout);
    let ok = res.ok;
    let message = `${res.status} ${res.statusText}`;
    if (!ok && res.status === 405) {
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

export async function integrationsRoutes(server: FastifyInstance) {
  // --- List ---
  server.get('/api/admin/integrations', {
    preHandler: [authenticate, requirePermission('integrations:read')],
  }, async (request) => {
    const query = request.query as { type?: string };
    const rows = await db.select().from(integrations).orderBy(integrations.name);
    const filtered = query?.type ? rows.filter(r => r.type === query.type) : rows;
    return { integrations: filtered.map(maskIntegration) };
  });

  // --- Get one ---
  server.get('/api/admin/integrations/:id', {
    preHandler: [authenticate, requirePermission('integrations:read')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await db.select().from(integrations).where(eq(integrations.id, id)).limit(1);
    if (!rows.length) return reply.status(404).send({ error: 'Integration nicht gefunden' });
    return { integration: maskIntegration(rows[0]) };
  });

  // --- Create ---
  server.post('/api/admin/integrations', {
    preHandler: [authenticate, requirePermission('integrations:write')],
  }, async (request, reply) => {
    const parsed = createIntegrationSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validierung fehlgeschlagen', details: parsed.error.flatten() });
    const id = uuidv4();
    const now = new Date();
    const row = {
      id,
      name: parsed.data.name,
      type: parsed.data.type,
      endpoint: parsed.data.endpoint || null,
      credentials: parsed.data.credentials || {},
      isEnabled: parsed.data.isEnabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await db.insert(integrations).values(row);
    } catch (err: any) {
      if (err.message?.includes('unique') || err.code === '23505') {
        return reply.status(409).send({ error: 'Name bereits vergeben' });
      }
      throw err;
    }
    await logAudit({
      userId: (request as any).user?.sub,
      action: 'integration_created',
      entity: 'integration',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent']?.toString(),
      success: true,
    });
    return reply.status(201).send({ integration: maskIntegration({ ...row, lastTestedAt: null, lastTestResult: null } as any) });
  });

  // --- Update ---
  server.patch('/api/admin/integrations/:id', {
    preHandler: [authenticate, requirePermission('integrations:write')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateIntegrationSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validierung fehlgeschlagen', details: parsed.error.flatten() });
    const existing = await db.select().from(integrations).where(eq(integrations.id, id)).limit(1);
    if (!existing.length) return reply.status(404).send({ error: 'Integration nicht gefunden' });

    // Merge credentials: if patch contains credentials, replace; otherwise keep existing
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.type !== undefined) updates.type = parsed.data.type;
    if (parsed.data.endpoint !== undefined) updates.endpoint = parsed.data.endpoint;
    if (parsed.data.credentials !== undefined) updates.credentials = parsed.data.credentials;
    if (parsed.data.isEnabled !== undefined) updates.isEnabled = parsed.data.isEnabled;

    try {
      await db.update(integrations).set(updates as any).where(eq(integrations.id, id));
    } catch (err: any) {
      if (err.message?.includes('unique') || err.code === '23505') {
        return reply.status(409).send({ error: 'Name bereits vergeben' });
      }
      throw err;
    }
    await logAudit({
      userId: (request as any).user?.sub,
      action: 'integration_updated',
      entity: 'integration',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent']?.toString(),
      success: true,
    });
    const updated = await db.select().from(integrations).where(eq(integrations.id, id)).limit(1);
    return { integration: maskIntegration(updated[0]) };
  });

  // --- Delete ---
  server.delete('/api/admin/integrations/:id', {
    preHandler: [authenticate, requirePermission('integrations:write')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await db.select().from(integrations).where(eq(integrations.id, id)).limit(1);
    if (!existing.length) return reply.status(404).send({ error: 'Integration nicht gefunden' });
    await db.delete(integrations).where(eq(integrations.id, id));
    await logAudit({
      userId: (request as any).user?.sub,
      action: 'integration_deleted',
      entity: 'integration',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent']?.toString(),
      success: true,
    });
    return { success: true };
  });

  // --- Test ---
  server.post('/api/admin/integrations/:id/test', {
    preHandler: [authenticate, requirePermission('integrations:write')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await db.select().from(integrations).where(eq(integrations.id, id)).limit(1);
    if (!rows.length) return reply.status(404).send({ error: 'Integration nicht gefunden' });
    const row = rows[0];
    // Allow override credentials/endpoint via body for test without saving
    const body = (request.body || {}) as { endpoint?: string; credentials?: Record<string, string> };
    const endpoint = body.endpoint ?? (row.endpoint || '');
    const creds = (body.credentials ?? (row.credentials as Record<string, string>)) || {};

    const result = await testEndpoint(endpoint, creds);
    const now = new Date();
    await db.update(integrations).set({
      lastTestedAt: now,
      lastTestResult: result,
      updatedAt: now,
    }).where(eq(integrations.id, id));

    await logAudit({
      userId: (request as any).user?.sub,
      action: 'integration_tested',
      entity: 'integration',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent']?.toString(),
      success: result.ok,
    });

    return { result, integration: maskIntegration({ ...row, lastTestedAt: now, lastTestResult: result } as any) };
  });
}
