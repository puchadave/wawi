import Fastify from 'fastify';
import { MODULE_REGISTRY } from '@fullautonom/shared';
import { LogisticsHubService, SupplierSchema, SupplierOrderSchema, ReturnSchema } from './service.js';

const config = MODULE_REGISTRY['logistics-hub'];
const app = Fastify({ logger: true });
const logistics = new LogisticsHubService();

app.get('/health', async () => ({
  moduleId: config.id,
  status: 'healthy',
  timestamp: new Date().toISOString(),
  suppliers: logistics.getSuppliers().length,
}));

app.post('/suppliers', async (request, reply) => {
  const result = SupplierSchema.safeParse(request.body);
  if (!result.success) return reply.status(400).send({ error: result.error.issues });
  const supplier = logistics.registerSupplier(result.data);
  return reply.status(201).send(supplier);
});

app.get('/suppliers', async () => logistics.getSuppliers());

app.post('/orders', async (request, reply) => {
  const result = SupplierOrderSchema.safeParse(request.body);
  if (!result.success) return reply.status(400).send({ error: result.error.issues });
  try {
    const order = await logistics.createOrderFromCustomer(result.data.items, result.data.totalAmount);
    return reply.status(201).send(order);
  } catch (e) {
    return reply.status(500).send({ error: (e as Error).message });
  }
});

app.get('/orders/:id/track', async (request, reply) => {
  const { id } = request.params as { id: string };
  const order = logistics.trackOrder(id);
  if (!order) return reply.status(404).send({ error: 'Order not found' });
  return order;
});

app.post('/returns', async (request, reply) => {
  const result = ReturnSchema.safeParse(request.body);
  if (!result.success) return reply.status(400).send({ error: result.error.issues });
  const order = await logistics.processReturn(result.data);
  return { success: true, order };
});

app.get('/shipping-rates', async () => logistics.getShippingRates());

app.listen({ port: config.port, host: config.host }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
  app.log.info(`Logistics-Hub running on ${config.host}:${config.port}`);
});