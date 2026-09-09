import { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import {
  aiProviders,
  aiModels,
  aiPrompts,
  aiProcessingRuns,
} from '../schema.js';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, requirePermission } from '../auth/middleware.js';
import { logAudit } from '../auth/audit.js';
import { runProductPipeline } from '../ai/pipeline.js';
import { PROCESSOR_MAP } from '../ai/processors.js';

const createProviderSchema = z.object({
  name: z.string().trim().min(2).max(100),
  type: z.enum(['openai', 'anthropic', 'openai-compatible']),
  endpoint: z.string().trim().url().max(2000).optional().nullable(),
  apiKeyEnvVar: z.string().trim().min(1).max(200).optional().nullable(),
  authSecretId: z.string().trim().max(200).optional().nullable(),
  isEnabled: z.boolean().optional().default(false),
});

const updateProviderSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  type: z.enum(['openai', 'anthropic', 'openai-compatible']).optional(),
  endpoint: z.string().trim().url().max(2000).optional().nullable(),
  apiKeyEnvVar: z.string().trim().min(1).max(200).optional().nullable(),
  authSecretId: z.string().trim().max(200).optional().nullable(),
  isEnabled: z.boolean().optional(),
});

const createModelSchema = z.object({
  providerId: z.string().trim().min(1),
  modelName: z.string().trim().min(1).max(200),
  config: z.record(z.string(), z.unknown()).optional().default({}),
  isEnabled: z.boolean().optional().default(false),
});

const updateModelSchema = z.object({
  providerId: z.string().trim().min(1).optional(),
  modelName: z.string().trim().min(1).max(200).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  isEnabled: z.boolean().optional(),
});

const createPromptSchema = z.object({
  name: z.string().trim().min(2).max(100),
  version: z.string().trim().min(1).max(50),
  template: z.string().trim().min(10).max(20000),
  contextVariables: z.array(z.string().trim().min(1)).optional().default(['title', 'brand', 'description', 'categoryPath', 'images']),
  isEnabled: z.boolean().optional().default(true),
});

const updatePromptSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  version: z.string().trim().min(1).max(50).optional(),
  template: z.string().trim().min(10).max(20000).optional(),
  contextVariables: z.array(z.string().trim().min(1)).optional(),
  isEnabled: z.boolean().optional(),
});

const runSchema = z.object({
  productId: z.string().trim().min(1),
  providerId: z.string().trim().min(1),
  modelId: z.string().trim().min(1),
  promptId: z.string().trim().min(1).optional().nullable(),
  processorNames: z.array(z.string().trim().min(1)).min(1).max(10),
  targetLanguage: z.string().trim().max(10).optional().nullable(),
  options: z
    .object({
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().positive().max(32000).optional(),
      timeoutMs: z.number().int().positive().max(300000).optional(),
    })
    .optional(),
});

export async function aiRoutes(server: FastifyInstance) {
  // ---- Providers ----
  server.get(
    '/api/admin/ai/providers',
    { preHandler: [authenticate, requirePermission('ai:read')] },
    async () => {
      const rows = await db.select().from(aiProviders).orderBy(aiProviders.name);
      return { providers: rows };
    },
  );

  server.post(
    '/api/admin/ai/providers',
    { preHandler: [authenticate, requirePermission('ai:write')] },
    async (request, reply) => {
      const parsed = createProviderSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Ungueltige Provider-Daten', details: parsed.error.flatten() });
      const data = parsed.data;
      const existing = await db.select().from(aiProviders).where(eq(aiProviders.name, data.name)).limit(1);
      if (existing.length) return reply.status(409).send({ error: `Provider "${data.name}" existiert bereits` });
      const row = {
        id: uuidv4(),
        name: data.name,
        type: data.type,
        endpoint: data.endpoint ?? null,
        apiKeyEnvVar: data.apiKeyEnvVar ?? null,
        authSecretId: data.authSecretId ?? null,
        isEnabled: data.isEnabled ?? false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await db.insert(aiProviders).values(row as any);
      await logAudit({ userId: (request as any).user?.sub ?? 'unknown', action: 'ai.provider.create', resource: row.id, details: { name: row.name } } as any);
      return reply.status(201).send({ provider: row });
    },
  );

  server.patch(
    '/api/admin/ai/providers/:id',
    { preHandler: [authenticate, requirePermission('ai:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateProviderSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Ungueltige Daten', details: parsed.error.flatten() });
      const [existing] = await db.select().from(aiProviders).where(eq(aiProviders.id, id)).limit(1);
      if (!existing) return reply.status(404).send({ error: 'Provider nicht gefunden' });
      if (parsed.data.name && parsed.data.name !== existing.name) {
        const dup = await db.select().from(aiProviders).where(eq(aiProviders.name, parsed.data.name)).limit(1);
        if (dup.length) return reply.status(409).send({ error: `Name "${parsed.data.name}" bereits vergeben` });
      }
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) (patch as any)[k] = v;
      await db.update(aiProviders).set(patch as any).where(eq(aiProviders.id, id));
      const [updated] = await db.select().from(aiProviders).where(eq(aiProviders.id, id)).limit(1);
      return { provider: updated };
    },
  );

  server.delete(
    '/api/admin/ai/providers/:id',
    { preHandler: [authenticate, requirePermission('ai:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const [existing] = await db.select().from(aiProviders).where(eq(aiProviders.id, id)).limit(1);
      if (!existing) return reply.status(404).send({ error: 'Provider nicht gefunden' });
      await db.delete(aiProviders).where(eq(aiProviders.id, id));
      await logAudit({ userId: (request as any).user?.sub ?? 'unknown', action: 'ai.provider.delete', resource: id } as any);
      return reply.status(204).send();
    },
  );

  server.post(
    '/api/admin/ai/providers/:id/test',
    { preHandler: [authenticate, requirePermission('ai:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const [provider] = await db.select().from(aiProviders).where(eq(aiProviders.id, id)).limit(1);
      if (!provider) return reply.status(404).send({ error: 'Provider nicht gefunden' });
      const { createAiAdapter } = await import('../ai/adapters.js');
      try {
        const adapter = createAiAdapter(provider as any);
        const result = await adapter.test();
        return { test: result };
      } catch (err: any) {
        return reply.status(502).send({ error: err.message ?? String(err) });
      }
    },
  );

  // ---- Models ----
  server.get(
    '/api/admin/ai/models',
    { preHandler: [authenticate, requirePermission('ai:read')] },
    async () => {
      const rows = await db.select().from(aiModels).orderBy(aiModels.modelName);
      return { models: rows };
    },
  );

  server.post(
    '/api/admin/ai/models',
    { preHandler: [authenticate, requirePermission('ai:write')] },
    async (request, reply) => {
      const parsed = createModelSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Ungueltige Modell-Daten', details: parsed.error.flatten() });
      const data = parsed.data;
      const [provider] = await db.select().from(aiProviders).where(eq(aiProviders.id, data.providerId)).limit(1);
      if (!provider) return reply.status(400).send({ error: `Provider ${data.providerId} nicht gefunden` });
      const row = {
        id: uuidv4(),
        providerId: data.providerId,
        modelName: data.modelName,
        config: data.config ?? {},
        isEnabled: data.isEnabled ?? false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await db.insert(aiModels).values(row as any);
      return reply.status(201).send({ model: row });
    },
  );

  server.patch(
    '/api/admin/ai/models/:id',
    { preHandler: [authenticate, requirePermission('ai:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateModelSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Ungueltige Daten', details: parsed.error.flatten() });
      const [existing] = await db.select().from(aiModels).where(eq(aiModels.id, id)).limit(1);
      if (!existing) return reply.status(404).send({ error: 'Modell nicht gefunden' });
      if (parsed.data.providerId) {
        const [p] = await db.select().from(aiProviders).where(eq(aiProviders.id, parsed.data.providerId)).limit(1);
        if (!p) return reply.status(400).send({ error: 'Provider nicht gefunden' });
      }
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) (patch as any)[k] = v;
      await db.update(aiModels).set(patch as any).where(eq(aiModels.id, id));
      const [updated] = await db.select().from(aiModels).where(eq(aiModels.id, id)).limit(1);
      return { model: updated };
    },
  );

  server.delete(
    '/api/admin/ai/models/:id',
    { preHandler: [authenticate, requirePermission('ai:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const [existing] = await db.select().from(aiModels).where(eq(aiModels.id, id)).limit(1);
      if (!existing) return reply.status(404).send({ error: 'Modell nicht gefunden' });
      await db.delete(aiModels).where(eq(aiModels.id, id));
      return reply.status(204).send();
    },
  );

  // ---- Prompts ----
  server.get(
    '/api/admin/ai/prompts',
    { preHandler: [authenticate, requirePermission('ai:read')] },
    async () => {
      const rows = await db.select().from(aiPrompts).orderBy(aiPrompts.name);
      return { prompts: rows };
    },
  );

  server.post(
    '/api/admin/ai/prompts',
    { preHandler: [authenticate, requirePermission('ai:write')] },
    async (request, reply) => {
      const parsed = createPromptSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Ungueltige Prompt-Daten', details: parsed.error.flatten() });
      const data = parsed.data;
      const dup = await db.select().from(aiPrompts).where(eq(aiPrompts.name, data.name)).limit(1);
      if (dup.length) return reply.status(409).send({ error: `Prompt "${data.name}" existiert bereits` });
      const row = {
        id: uuidv4(),
        name: data.name,
        version: data.version,
        template: data.template,
        contextVariables: data.contextVariables ?? ['title', 'brand', 'description', 'categoryPath', 'images'],
        isEnabled: data.isEnabled ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await db.insert(aiPrompts).values(row as any);
      return reply.status(201).send({ prompt: row });
    },
  );

  server.patch(
    '/api/admin/ai/prompts/:id',
    { preHandler: [authenticate, requirePermission('ai:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updatePromptSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Ungueltige Daten', details: parsed.error.flatten() });
      const [existing] = await db.select().from(aiPrompts).where(eq(aiPrompts.id, id)).limit(1);
      if (!existing) return reply.status(404).send({ error: 'Prompt nicht gefunden' });
      if (parsed.data.name && parsed.data.name !== existing.name) {
        const dup = await db.select().from(aiPrompts).where(eq(aiPrompts.name, parsed.data.name)).limit(1);
        if (dup.length) return reply.status(409).send({ error: `Name bereits vergeben` });
      }
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) (patch as any)[k] = v;
      await db.update(aiPrompts).set(patch as any).where(eq(aiPrompts.id, id));
      const [updated] = await db.select().from(aiPrompts).where(eq(aiPrompts.id, id)).limit(1);
      return { prompt: updated };
    },
  );

  server.delete(
    '/api/admin/ai/prompts/:id',
    { preHandler: [authenticate, requirePermission('ai:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const [existing] = await db.select().from(aiPrompts).where(eq(aiPrompts.id, id)).limit(1);
      if (!existing) return reply.status(404).send({ error: 'Prompt nicht gefunden' });
      await db.delete(aiPrompts).where(eq(aiPrompts.id, id));
      return reply.status(204).send();
    },
  );

  // ---- Processors (read-only catalogue) ----
  server.get(
    '/api/admin/ai/processors',
    { preHandler: [authenticate, requirePermission('ai:read')] },
    async () => {
      const processors = Object.values(PROCESSOR_MAP).map((p) => ({
        name: p.name,
        label: p.label,
        description: p.description,
        fields: p.fields,
      }));
      return { processors };
    },
  );

  // ---- Runs ----
  server.get(
    '/api/admin/ai/runs',
    { preHandler: [authenticate, requirePermission('ai:read')] },
    async (request) => {
      const { productId } = request.query as { productId?: string };
      let rows;
      if (productId) {
        rows = await db.select().from(aiProcessingRuns).where(eq(aiProcessingRuns.productId, productId)).orderBy(desc(aiProcessingRuns.createdAt)).limit(50);
      } else {
        rows = await db.select().from(aiProcessingRuns).orderBy(desc(aiProcessingRuns.createdAt)).limit(50);
      }
      return { runs: rows };
    },
  );

  server.get(
    '/api/admin/ai/runs/:id',
    { preHandler: [authenticate, requirePermission('ai:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const [run] = await db.select().from(aiProcessingRuns).where(eq(aiProcessingRuns.id, id)).limit(1);
      if (!run) return reply.status(404).send({ error: 'Run nicht gefunden' });
      return { run };
    },
  );

  server.post(
    '/api/admin/ai/run',
    { preHandler: [authenticate, requirePermission('ai:write')] },
    async (request, reply) => {
      const parsed = runSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Ungueltige Run-Daten', details: parsed.error.flatten() });
      const data = parsed.data;

      // Validate processors exist
      const unknown = data.processorNames.filter((n) => !PROCESSOR_MAP[n]);
      if (unknown.length) return reply.status(400).send({ error: `Unbekannte Prozessoren: ${unknown.join(', ')} (verfuegbar: ${Object.keys(PROCESSOR_MAP).join(', ')})` });

      try {
        const result = await runProductPipeline({
          productId: data.productId,
          providerId: data.providerId,
          modelId: data.modelId,
          promptId: data.promptId ?? null,
          processorNames: data.processorNames,
          targetLanguage: data.targetLanguage ?? undefined,
          options: data.options,
        });
        await logAudit({ userId: (request as any).user?.sub ?? 'unknown', action: 'ai.run', resource: result.runId, details: { productId: data.productId, processors: data.processorNames } } as any);
        return reply.status(201).send({ result });
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        // runProductPipeline already persisted a failed run; surface error
        return reply.status(422).send({ error: msg });
      }
    },
  );
}
