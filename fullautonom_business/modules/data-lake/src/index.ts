import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { MODULE_REGISTRY } from '@fullautonom/shared';

// ============================================================================
// Data-Lake Service — PostgreSQL/Redis connector & raw-data storage
// ============================================================================

const config = MODULE_REGISTRY['data-lake'];
const app = Fastify({ logger: true });

interface DataLakeEntry {
  id: string;
  source: string;
  type: string;
  payload: Record<string, unknown>;
  ingestedAt: string;
  ttl?: number;
}

const entries: Map<string, DataLakeEntry> = new Map();

app.get('/health', async () => ({
  moduleId: config.id,
  status: 'healthy',
  timestamp: new Date().toISOString(),
  totalEntries: entries.size,
}));

app.post('/api/ingest', async (req: FastifyRequest, reply: FastifyReply) => {
  const body = req.body as { source: string; type: string; payload: Record<string, unknown>; ttl?: number };
  const entry: DataLakeEntry = {
    id: crypto.randomUUID(),
    source: body.source,
    type: body.type,
    payload: body.payload,
    ingestedAt: new Date().toISOString(),
    ttl: body.ttl,
  };
  entries.set(entry.id, entry);
  return reply.status(201).send({ ok: true, id: entry.id });
});

app.get('/api/query', async (req: FastifyRequest) => {
  const { source, type, limit } = req.query as { source?: string; type?: string; limit?: string };
  const maxLimit = Math.min(parseInt(limit || '50'), 200);
  let results = Array.from(entries.values());
  if (source) results = results.filter((e) => e.source === source);
  if (type) results = results.filter((e) => e.type === type);
  return { entries: results.slice(-maxLimit), total: results.length };
});

app.get('/api/stats', async () => {
  const sourceCounts: Record<string, number> = {};
  for (const entry of entries.values()) {
    sourceCounts[entry.source] = (sourceCounts[entry.source] || 0) + 1;
  }
  return { totalEntries: entries.size, bySource: sourceCounts };
});

app.delete('/api/entries/:id', async (req: FastifyRequest, reply: FastifyReply) => {
  const { id } = req.params as { id: string };
  if (entries.delete(id)) return { ok: true };
  return reply.status(404).send({ error: 'Not found' });
});

app.listen({ port: config.port, host: config.host }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`data-lake listening on ${config.host}:${config.port}`);
});
