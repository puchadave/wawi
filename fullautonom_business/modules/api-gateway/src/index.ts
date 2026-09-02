import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { MODULE_REGISTRY, getModuleConfig, getModuleEndpoints } from '@fullautonom/shared';
import { ModuleId, ModuleHealth, ModuleMetrics } from '@fullautonom/shared';

// ============================================================================
// API-Gateway Service — Service Mesh, Registry, Health, Rate-Limit
// ============================================================================

interface CachedHealth {
  health: ModuleHealth;
  recordedAt: Date;
}

interface ClientRateLimit {
  count: number;
  windowStart: number;
}

export class GatewayService {
  private healthCache = new Map<string, CachedHealth>();
  private moduleMetrics = new Map<string, ModuleMetrics>();
  private rateLimitStore = new Map<string, ClientRateLimit>();
  private readonly RATE_LIMIT_WINDOW_MS = 60000;
  private readonly RATE_LIMIT_MAX = 100;

  async reportHealth(moduleId: string, status: 'healthy' | 'degraded' | 'down', uptime: number): Promise<ModuleHealth> {
    const config = getModuleConfig(moduleId as any);
    if (!config) throw new Error(`Unknown module: ${moduleId}`);
    
    const health: ModuleHealth = {
      moduleId: moduleId as any,
      status,
      uptime,
      lastCheck: new Date(),
      metrics: this.moduleMetrics.get(moduleId) || {
        requestsTotal: 0,
        requestsPerMinute: 0,
        avgResponseTimeMs: 0,
        errorRate: 0,
        memoryUsageMb: 0,
        cpuUsagePercent: 0,
      },
    };
    this.healthCache.set(moduleId, { health, recordedAt: new Date() });
    return health;
  }

  async reportMetric(moduleId: string, metrics: Partial<ModuleMetrics>): Promise<void> {
    const current = this.moduleMetrics.get(moduleId) || {
      requestsTotal: 0,
      requestsPerMinute: 0,
      avgResponseTimeMs: 0,
      errorRate: 0,
      memoryUsageMb: 0,
      cpuUsagePercent: 0,
    };
    this.moduleMetrics.set(moduleId, { ...current, ...metrics });
  }

  getAllModuleHealth(): ModuleHealth[] {
    return Array.from(this.healthCache.values()).map(c => c.health);
  }

  getModuleHealth(moduleId: string): ModuleHealth | undefined {
    return this.healthCache.get(moduleId)?.health;
  }

  getRegistry() {
    return MODULE_REGISTRY;
  }

  getEndpoints(moduleId: string) {
    return getModuleEndpoints(moduleId as any);
  }

  checkRateLimit(clientKey: string): boolean {
    const now = Date.now();
    const entry = this.rateLimitStore.get(clientKey);
    if (!entry || now - entry.windowStart > this.RATE_LIMIT_WINDOW_MS) {
      this.rateLimitStore.set(clientKey, { count: 1, windowStart: now });
      return true;
    }
    if (entry.count >= this.RATE_LIMIT_MAX) return false;
    entry.count++;
    return true;
  }
}

const gateway = new GatewayService();
const config = MODULE_REGISTRY['api-gateway'];

export async function buildApp(): Promise<FastifyInstance> {
  const app = (await import('fastify')).default({ logger: true });
  const cors = (await import('@fastify/cors')).default;
  const rateLimit = (await import('@fastify/rate-limit')).default;

  await app.register(cors, { origin: '*' });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  app.get('/health', async () => ({
    moduleId: config.id,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    registeredModules: Object.keys(MODULE_REGISTRY).length,
  }));

  app.get('/modules', async () => ({
    modules: gateway.getRegistry(),
    health: gateway.getAllModuleHealth(),
  }));

  app.get('/modules/:id/health', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const health = gateway.getModuleHealth(request.params.id);
    if (!health) return reply.status(404).send({ error: `Module ${request.params.id} not reported yet` });
    return health;
  });

  app.post('/report-health', async (request: FastifyRequest<{ Body: { moduleId: string; status: 'healthy' | 'degraded' | 'down'; uptime: number } }>, reply: FastifyReply) => {
    const { moduleId, status, uptime } = request.body;
    if (!MODULE_REGISTRY[moduleId as ModuleId]) return reply.status(400).send({ error: 'Unknown module' });
    const health = await gateway.reportHealth(moduleId, status, uptime);
    return reply.status(201).send(health);
  });

  app.post('/report-metric', async (request: FastifyRequest<{ Body: { moduleId: string; metrics: Partial<ModuleMetrics> } }>) => {
    const { moduleId, metrics } = request.body;
    await gateway.reportMetric(moduleId, metrics);
    return { success: true };
  });

  app.get('/modules/:id/endpoints', async (request: FastifyRequest<{ Params: { id: string } }>) => {
    return { endpoints: gateway.getEndpoints(request.params.id) };
  });

  app.get('/rate-limit-check', async (request: FastifyRequest, reply: FastifyReply) => {
    const clientKey = request.headers['x-client'] as string || 'anonymous';
    const allowed = gateway.checkRateLimit(clientKey);
    if (!allowed) return reply.status(429).send({ error: 'Rate limit exceeded' });
    return { allowed: true };
  });

  return app;
}

export async function start() {
  const app = await buildApp();
  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`API-Gateway running on ${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();