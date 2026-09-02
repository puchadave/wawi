import Fastify from 'fastify';
import { MODULE_REGISTRY } from '@fullautonom/shared';
import { CrmIntelService, CreateCustomerSchema, SocialProfileSchema, HumintProfileSchema, LeadGenerateSchema } from './service.js';

const config = MODULE_REGISTRY['crm-intel'];
const app = Fastify({ logger: true });
const crm = new CrmIntelService();

app.get('/health', async () => ({
  moduleId: config.id,
  status: 'healthy',
  timestamp: new Date().toISOString(),
  profileCount: (await crm.listCustomers()).length,
}));

app.post('/customers', async (request, reply) => {
  const result = CreateCustomerSchema.safeParse(request.body);
  if (!result.success) return reply.status(400).send({ error: result.error.issues });
  const profile = await crm.createCustomer(result.data);
  return reply.status(201).send(profile);
});

app.get('/customers', async (request) => {
  const { segment, isLead } = request.query as { segment?: string; isLead?: string };
  return crm.listCustomers({ segment: segment as any, isLead: isLead === 'true' });
});

app.get('/customers/:id/profile', async (request, reply) => {
  const { id } = request.params as { id: string };
  const profile = await crm.getCustomer(id);
  if (!profile) return reply.status(404).send({ error: 'Not found' });
  return profile;
});

app.post('/customers/:id/social', async (request, reply) => {
  const { id } = request.params as { id: string };
  const result = SocialProfileSchema.safeParse(request.body);
  if (!result.success) return reply.status(400).send({ error: result.error.issues });
  const social = await crm.addSocialProfile(id, result.data);
  return reply.status(201).send(social);
});

app.put('/customers/:id/humint', async (request, reply) => {
  const { id } = request.params as { id: string };
  const result = HumintProfileSchema.safeParse(request.body);
  if (!result.success) return reply.status(400).send({ error: result.error.issues });
  const humint = await crm.updateHumintProfile(id, result.data);
  return humint;
});

app.get('/leads', async (request) => {
  const { musicGenres, segment, minScore } = request.query as { musicGenres?: string; segment?: string; minScore?: string };
  return crm.getLeads({
    musicGenres: musicGenres ? musicGenres.split(',') : undefined,
    segment: segment as any,
    minScore: minScore ? parseInt(minScore) : undefined,
  });
});

app.post('/leads/generate', async (request, reply) => {
  const result = LeadGenerateSchema.safeParse(request.body);
  if (!result.success) return reply.status(400).send({ error: result.error.issues });
  const generatedLead = await crm.generateLeadFromOsint({
    platform: 'instagram',
    handle: `festival_${Date.now() % 10000}`,
    followers: Math.floor(Math.random() * 5000),
    engagementRate: Math.random() * 8,
    interests: result.data.musicGenres,
    hashtags: result.data.hashtags,
  });
  return reply.status(201).send(generatedLead);
});

app.listen({ port: config.port, host: config.host }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
  app.log.info(`CRM-Intel running on ${config.host}:${config.port}`);
});