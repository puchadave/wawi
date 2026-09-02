import Fastify from 'fastify';
import { MODULE_REGISTRY } from '@fullautonom/shared';
import { EcommerceCoreService, ProductCreateSchema, SyncRequestSchema, OrderProcessSchema } from './service.js';

const config = MODULE_REGISTRY['ecommerce-core'];
const app = Fastify({ logger: true });
const ecommerce = new EcommerceCoreService();

app.get('/health', async () => ({
  moduleId: config.id,
  status: 'healthy',
  timestamp: new Date().toISOString(),
  products: ecommerce.getProducts().length,
}));

app.post('/products', async (request, reply) => {
  const result = ProductCreateSchema.safeParse(request.body);
  if (!result.success) return reply.status(400).send({ error: result.error.issues });
  const product = ecommerce.createProduct(result.data);
  return reply.status(201).send(product);
});

app.get('/products', async (request) => {
  const { status, genre } = request.query as { status?: string; genre?: string };
  return ecommerce.getProducts({ status, genre });
});

app.post('/products/:id/sync', async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    const result = await ecommerce.syncToShopware(id);
    return result;
  } catch (e) {
    return reply.status(404).send({ error: (e as Error).message });
  }
});

app.get('/orders', async () => ecommerce.getOrders());

app.post('/orders', async (request, reply) => {
  const result = OrderProcessSchema.safeParse(request.body);
  if (!result.success) return reply.status(400).send({ error: result.error.issues });
  await ecommerce.processOrder(result.data);
  return { success: true, orderId: result.data.orderId };
});

app.listen({ port: config.port, host: config.host }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
  app.log.info(`Ecommerce-Core running on ${config.host}:${config.port}`);
});