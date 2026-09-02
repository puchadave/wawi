import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { MODULE_REGISTRY } from '@fullautonom/shared';
import { BusinessIntelligenceService, ReportRequestSchema, BudgetAdjustSchema } from './service.js';

const config = MODULE_REGISTRY['bi-brain'];
const app = Fastify({ logger: true });
const service = new BusinessIntelligenceService();

service.setEventEmitter(async (event) => {
  app.log.info({ event }, 'BI-Brain emitted event');
});

app.get('/health', async () => ({
  status: 'ok',
  module: 'bi-brain',
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
}));

app.post('/api/reports/generate', async (req: FastifyRequest, reply: FastifyReply) => {
  const body = req.body as Record<string, string>;
  const parsed = ReportRequestSchema.safeParse(body);
  if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
  const report = service.generateReport(parsed.data.type);
  return reply.send({ report });
});

app.get('/api/reports', async () => ({
  reports: service.getReports(),
}));

app.post('/api/budget/allocations', async () => ({
  allocations: service.calculateBudgetAllocations(),
}));

app.get('/api/budget', async () => ({
  budget: service.getBudget(),
}));

app.post('/api/recommendations', async () => ({
  recommendations: service.generateRecommendations(),
}));

app.get('/api/recommendations', async () => ({
  recommendations: service.getRecommendations(),
}));

app.get('/api/business-plan', async () => ({
  plan: service.generateBusinessPlan(),
}));

app.post('/api/metrics/record', async (req: FastifyRequest, reply: FastifyReply) => {
  const body = req.body as { moduleId: string; metric: string; value: number };
  service.recordModuleMetric(body.moduleId, body.metric, body.value);
  return reply.send({ ok: true });
});

app.listen({ port: config.port, host: config.host }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`bi-brain listening on ${config.host}:${config.port}`);
});
