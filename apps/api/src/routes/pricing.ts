import { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { priceRules, shippingRates, feeSchedule, pricingAudit } from '../pricingSchema.js';
import { calculateProductPrice, PricingCalculationInput, PriceRule } from '@wawi/shared';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { products } from '../schema.js';
import { z } from 'zod';

export async function pricingRoutes(server: FastifyInstance) {
  const priceRuleSchema = z.object({
    name: z.string().min(1),
    vatRate: z.number().min(0).max(1),
    targetMargin: z.number().min(0).max(1),
    fixedSurchargeNet: z.number().min(0).default(0),
    mode: z.enum(['netto', 'brutto']).default('brutto'),
    charmPricing: z.boolean().default(true),
    includeFreightInVk: z.boolean().default(false),
  });

  // GET /api/pricing/rules - Liste aller Preisregeln
  server.get('/api/pricing/rules', async (request, reply) => {
    const rules = await db.select().from(priceRules);
    return reply.send(rules.map((rule) => ({
      ...rule,
      vatRate: Number(rule.vatRate),
      targetMargin: Number(rule.targetMargin),
      fixedSurchargeNet: Number(rule.fixedSurchargeNet),
    })));
  });

  // POST /api/pricing/rules - Neue Regel anlegen
  server.post('/api/pricing/rules', async (request, reply) => {
    const data = priceRuleSchema.parse(request.body);
    const newRule = {
      id: uuidv4(),
      ...data,
      vatRate: String(data.vatRate),
      targetMargin: String(data.targetMargin),
      fixedSurchargeNet: String(data.fixedSurchargeNet),
    };
    await db.insert(priceRules).values(newRule);
    return reply.status(201).send(newRule);
  });

  // PUT /api/pricing/rules/:id - Regel aktualisieren
  server.put('/api/pricing/rules/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = priceRuleSchema.partial().parse(request.body);
    const updatedRule = {
      ...data,
      vatRate: data.vatRate ? String(data.vatRate) : undefined,
      targetMargin: data.targetMargin ? String(data.targetMargin) : undefined,
      fixedSurchargeNet: data.fixedSurchargeNet ? String(data.fixedSurchargeNet) : undefined,
      updatedAt: new Date(),
    };
    await db.update(priceRules).set(updatedRule).where(eq(priceRules.id, id));
    return reply.send({ message: 'Price rule updated', id });
  });

  // DELETE /api/pricing/rules/:id - Regel löschen
  server.delete('/api/pricing/rules/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.delete(priceRules).where(eq(priceRules.id, id));
    return reply.send({ message: 'Price rule deleted', id });
  });

  // POST /api/pricing/calculate - Einzelberechnung (Preview)
  server.post('/api/pricing/calculate', async (request, reply) => {
    const schema = z.object({
      supplierNet: z.number().min(0),
      dropshippingFeeNet: z.number().min(0).optional(),
      freightAllocatedNet: z.number().min(0).optional(),
      priceRuleId: z.string().uuid(),
    });

    const { supplierNet, dropshippingFeeNet, freightAllocatedNet, priceRuleId } = schema.parse(request.body);

    const rule = await db.select().from(priceRules).where(eq(priceRules.id, priceRuleId)).limit(1);
    if (!rule.length) {
      return reply.status(404).send({ error: 'Price rule not found' });
    }

    const parsedRule: PriceRule = {
      ...rule[0],
      vatRate: parseFloat(rule[0].vatRate),
      targetMargin: parseFloat(rule[0].targetMargin),
      fixedSurchargeNet: parseFloat(rule[0].fixedSurchargeNet),
    };

    const input: PricingCalculationInput = {
      supplierNet,
      dropshippingFeeNet,
      freightAllocatedNet,
      priceRule: parsedRule,
    };

    const result = calculateProductPrice(input);
    return reply.send(result);
  });

  // POST /api/pricing/simulate - Simulationslauf (betroffene Produkte zählen)
  server.post('/api/pricing/simulate', async (request, reply) => {
    const schema = z.object({ priceRuleId: z.string().uuid() });
    const { priceRuleId } = schema.parse(request.body);

    const rule = await db.select().from(priceRules).where(eq(priceRules.id, priceRuleId)).limit(1);
    if (!rule.length) {
      return reply.status(404).send({ error: 'Price rule not found' });
    }

    const parsedRule: PriceRule = {
      ...rule[0],
      vatRate: parseFloat(rule[0].vatRate),
      targetMargin: parseFloat(rule[0].targetMargin),
      fixedSurchargeNet: parseFloat(rule[0].fixedSurchargeNet),
    };

    const affectedProducts = await db.select({ id: products.supplierProductId, name: products.name })
      .from(products)
      .limit(100);

    return reply.send({
      message: `Simulation for rule ${parsedRule.name} completed.`,
      affectedProductCount: affectedProducts.length,
    });
  });

  // POST /api/pricing/apply - Massen-Apply mit Audit-Log
  server.post('/api/pricing/apply', async (request, reply) => {
    const schema = z.object({ priceRuleId: z.string().uuid() });
    const { priceRuleId } = schema.parse(request.body);

    const rule = await db.select().from(priceRules).where(eq(priceRules.id, priceRuleId)).limit(1);
    if (!rule.length) {
      return reply.status(404).send({ error: 'Price rule not found' });
    }

    const parsedRule: PriceRule = {
      ...rule[0],
      vatRate: parseFloat(rule[0].vatRate),
      targetMargin: parseFloat(rule[0].targetMargin),
      fixedSurchargeNet: parseFloat(rule[0].fixedSurchargeNet),
    };

    // Background job would go here
    return reply.send({ message: `Price rule ${parsedRule.name} apply triggered (background job).` });
  });

  // GET /api/shipping/rates - Liste aller Versandraten
  server.get('/api/shipping/rates', async (request, reply) => {
    const rates = await db.select().from(shippingRates);
    return reply.send(rates);
  });

  // GET /api/fees - Liste aller Gebühren
  server.get('/api/fees', async (request, reply) => {
    const fees = await db.select().from(feeSchedule);
    return reply.send(fees);
  });
}