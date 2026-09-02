import Fastify from 'fastify';
import { MODULE_REGISTRY } from '@fullautonom/shared';
import { AutonomousFinanceService, TransactionSchema } from './service.js';

const config = MODULE_REGISTRY['fibu-autonomous'];
const app = Fastify({ logger: true });
const finance = new AutonomousFinanceService();

finance.startAutoEnforcement();

app.get('/health', async () => ({
  moduleId: config.id,
  status: 'healthy',
  timestamp: new Date().toISOString(),
  balance: finance.getBalance(),
}));

app.get('/balance', async () => finance.getBalance());

app.post('/transactions', async (request, reply) => {
  const result = TransactionSchema.safeParse(request.body);
  if (!result.success) return reply.status(400).send({ error: result.error.issues });
  
  if (result.data.type === 'income') {
    const balance = await finance.recordIncome(result.data.orderId ?? '', result.data.amount, result.data.description);
    return reply.status(201).send({ ...result.data, balance });
  } else {
    const balance = await finance.recordExpense(result.data.amount, result.data.description, result.data.category, {
      orderId: result.data.orderId,
      supplierId: result.data.supplierId,
    });
    return reply.status(201).send({ ...result.data, balance });
  }
});

app.post('/enforce-rule', async () => {
  const balance = await finance.enforceTenSecondRule();
  return { success: true, balance };
});

app.post('/tax/calculate', async (request) => {
  const tax = finance.calculateTax(request.body as any);
  return tax;
});

app.get('/financial-health', async () => finance.calculateHealth());

app.get('/target-progress', async () => finance.getTargetProgress());

app.get('/transactions', async () => finance.getTransactions());

app.listen({ port: config.port, host: config.host }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
  app.log.info(`FiBu-Autonomous running on ${config.host}:${config.port}`);
});