import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { MODULE_REGISTRY } from '@fullautonom/shared';
import { OsintEngineService, TrendScanRequestSchema, CompetitorScanSchema, HashtagResearchSchema } from './service.js';

const config = MODULE_REGISTRY['osint-engine'];
const app = Fastify({ logger: true });
const service = new OsintEngineService();

service.setEventEmitter(async (event) => {
  app.log.info({ event }, 'OSINT emitted event');
});

app.get('/health', async () => ({
  status: 'ok',
  module: 'osint-engine',
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
}));

app.post('/api/trends/scan', async (req: FastifyRequest, reply: FastifyReply) => {
  const body = req.body as Record<string, string>;
  const parsed = TrendScanRequestSchema.safeParse(body);
  if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
  const trends = service.scanTrends(parsed.data.source, parsed.data.niche, parsed.data.timeframe);
  return reply.send({ trends });
});

app.get('/api/trends', async () => ({
  trends: service.getTrends(),
}));

app.post('/api/trends/clear-expired', async () => {
  const removed = service.clearExpiredTrends();
  return { removed };
});

app.post('/api/hashtags/research', async (req: FastifyRequest, reply: FastifyReply) => {
  const body = req.body as Record<string, string>;
  const parsed = HashtagResearchSchema.safeParse(body);
  if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
  const hashtags = service.researchHashtags(parsed.data.genre, parsed.data.platform, parsed.data.count);
  return reply.send({ hashtags });
});

app.post('/api/competitors/scan', async (req: FastifyRequest, reply: FastifyReply) => {
  const body = req.body as Record<string, string>;
  const parsed = CompetitorScanSchema.safeParse(body);
  if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
  const results = service.scanCompetitor(parsed.data.domain, parsed.data.platforms);
  return reply.send({ results });
});

app.post('/api/hashtags/bundle', async (req: FastifyRequest, reply: FastifyReply) => {
  const { genre } = req.body as { genre: string };
  const bundle = service.generateHashtagBundle(genre || 'hardstyle');
  return reply.send({ bundle });
});

app.listen({ port: config.port, host: config.host }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`osint-engine listening on ${config.host}:${config.port}`);
});
