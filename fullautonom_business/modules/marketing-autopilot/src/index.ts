import Fastify from 'fastify';
import { MODULE_REGISTRY } from '@fullautonom/shared';
import { MarketingAutopilotService, ContentRequestSchema, CampaignCreateSchema, PostContentSchema } from './service.js';

const config = MODULE_REGISTRY['marketing-autopilot'];
const app = Fastify({ logger: true });
const marketing = new MarketingAutopilotService();

app.get('/health', async () => ({
  moduleId: config.id,
  status: 'healthy',
  timestamp: new Date().toISOString(),
  campaigns: marketing.getCampaigns().length,
}));

app.post('/content/generate', async (request, reply) => {
  const result = ContentRequestSchema.safeParse(request.body);
  if (!result.success) return reply.status(400).send({ error: result.error.issues });
  const content = await marketing.generateContent(result.data);
  return reply.status(201).send(content);
});

app.post('/campaigns', async (request, reply) => {
  const result = CampaignCreateSchema.safeParse(request.body);
  if (!result.success) return reply.status(400).send({ error: result.error.issues });
  const campaign = marketing.createCampaign(result.data);
  return reply.status(201).send(campaign);
});

app.get('/campaigns', async () => marketing.getCampaigns());

app.post('/content/schedule', async (request, reply) => {
  const result = PostContentSchema.safeParse(request.body);
  if (!result.success) return reply.status(400).send({ error: result.error.issues });
  await marketing.schedulePost(result.data.contentId, result.data.platforms, result.data.scheduledAt ? new Date(result.data.scheduledAt) : undefined);
  return { success: true };
});

app.get('/optimal-times', async () => ({ times: marketing.getOptimalPostingTimes() }));

app.get('/content/log', async () => marketing.getContentLog());

app.listen({ port: config.port, host: config.host }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
  app.log.info(`Marketing-Autopilot running on ${config.host}:${config.port}`);
});