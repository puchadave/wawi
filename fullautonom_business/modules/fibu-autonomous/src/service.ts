import { z } from 'zod';
import { BalanceState, TaxCalculation, FinancialHealth, Transaction, DomainEvent, createDomainEvent, roundToCents } from '@fullautonom/shared';

// ============================================================================
// Zod Schemas
// ============================================================================

export const TransactionSchema = z.object({
  type: z.enum(['income', 'expense', 'transfer', 'tax']),
  amount: z.number().positive(),
  currency: z.string().default('EUR'),
  description: z.string(),
  category: z.string(),
  reference: z.string().optional(),
  orderId: z.string().optional(),
  supplierId: z.string().optional(),
});

export const TaxConfigSchema = z.object({
  vatRate: z.number().default(0.19),
  incomeTaxRate: z.number().default(0.30),
  tradeTaxRate: z.number().default(0.07),
  solidarityRate: z.number().default(0.055),
});

// ============================================================================
// FiBu Autonomous Service — 10-Sekunden-Fremdkapital-Regel
// ============================================================================

const MAX_FOREIGN_CAPITAL_DURATION_MS = 10_000;
const CHECK_INTERVAL_MS = 5_000;
const TARGET_PROFIT_WEEK2 = 500;
const TARGET_PROFIT_30D = 1000;

export class AutonomousFinanceService {
  private transactions: Transaction[] = [];
  private balance: BalanceState = {
    totalBalance: 0,
    foreignCapital: 0,
    ownCapital: 0,
    taxReserve: 0,
    lastUpdated: new Date(),
    maxForeignCapitalDurationMs: MAX_FOREIGN_CAPITAL_DURATION_MS,
    foreignCapitalEntries: [],
  };
  private checkInterval: NodeJS.Timeout | null = null;
  private eventEmitter: (event: DomainEvent) => Promise<void> = async () => {};

  setEventEmitter(emitter: (event: DomainEvent) => Promise<void>) {
    this.eventEmitter = emitter;
  }

  startAutoEnforcement() {
    if (this.checkInterval) return;
    this.checkInterval = setInterval(() => this.enforceTenSecondRule(), CHECK_INTERVAL_MS);
  }

  stopAutoEnforcement() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  async recordIncome(orderId: string, grossAmount: number, description: string): Promise<BalanceState> {
    const vat = roundToCents(grossAmount * 0.19);
    const netAmount = grossAmount - vat;

    const transaction: Transaction = {
      id: crypto.randomUUID(),
      type: 'income',
      amount: grossAmount,
      currency: 'EUR',
      description,
      category: 'sales',
      orderId,
      timestamp: new Date(),
    };
    this.transactions.push(transaction);

    this.balance.totalBalance += grossAmount;
    this.balance.foreignCapital += grossAmount;
    this.balance.foreignCapitalEntries.push({
      id: crypto.randomUUID(),
      amount: grossAmount,
      source: `Order ${orderId}`,
      receivedAt: new Date(),
    });
    this.balance.lastUpdated = new Date();

    await this.eventEmitter(createDomainEvent('payment.received', 'fibu-autonomous', { 
      orderId, amount: grossAmount, transactionId: transaction.id 
    }));

    return this.balance;
  }

  async recordExpense(amount: number, description: string, category: string, reference?: { orderId?: string; supplierId?: string }): Promise<BalanceState> {
    const transaction: Transaction = {
      id: crypto.randomUUID(),
      type: 'expense',
      amount,
      currency: 'EUR',
      description,
      category,
      orderId: reference?.orderId,
      supplierId: reference?.supplierId,
      timestamp: new Date(),
    };
    this.transactions.push(transaction);

    this.balance.totalBalance -= amount;
    if (category === 'cost_of_goods') {
      this.balance.foreignCapital = Math.max(0, this.balance.foreignCapital - amount);
      this.balance.ownCapital += amount;
    }
    this.balance.lastUpdated = new Date();

    await this.eventEmitter(createDomainEvent('payment.forwarded', 'fibu-autonomous', { 
      amount, category, reference 
    }));

    return this.balance;
  }

  async enforceTenSecondRule(): Promise<BalanceState> {
    const now = Date.now();
    const staleEntries = this.balance.foreignCapitalEntries.filter(
      e => !e.forwardedAt && now - e.receivedAt.getTime() > MAX_FOREIGN_CAPITAL_DURATION_MS
    );

    for (const entry of staleEntries) {
      await this.autoForwardToSupplier(entry);
      entry.forwardedAt = new Date();
      entry.durationMs = now - entry.receivedAt.getTime();
      await this.eventEmitter(createDomainEvent('fibu.balance_alert', 'fibu-autonomous', {
        type: 'foreign_capital_timeout',
        entryId: entry.id,
        amount: entry.amount,
        durationMs: entry.durationMs,
      }));
    }

    this.balance.lastUpdated = new Date();
    return this.balance;
  }

  private async autoForwardToSupplier(entry: { id: string; amount: number; source: string }): Promise<void> {
    const supplierCost = roundToCents(entry.amount * 0.6);
    this.balance.foreignCapital = Math.max(0, this.balance.foreignCapital - entry.amount);
    this.balance.ownCapital += entry.amount - supplierCost;
    this.balance.totalBalance -= supplierCost;

    this.transactions.push({
      id: crypto.randomUUID(),
      type: 'expense',
      amount: supplierCost,
      currency: 'EUR',
      description: `Auto-Lieferantenzahlung für ${entry.source}`,
      category: 'cost_of_goods',
      timestamp: new Date(),
    });
  }

  calculateTax(config?: z.infer<typeof TaxConfigSchema>): TaxCalculation {
    const { vatRate = 0.19, incomeTaxRate = 0.30, tradeTaxRate = 0.07, solidarityRate = 0.055 } = config ?? {};
    
    const revenue = this.transactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);

    const expenses = this.transactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);

    const netRevenue = roundToCents(revenue / (1 + vatRate));
    const vatAmount = revenue - netRevenue;
    const grossProfit = roundToCents(netRevenue - expenses);

    const incomeTax = grossProfit > 0 ? roundToCents(grossProfit * incomeTaxRate) : 0;
    const tradeTax = grossProfit > 24500 ? roundToCents(grossProfit * tradeTaxRate) : 0;
    const solidarityTax = incomeTax > 0 ? roundToCents(incomeTax * solidarityRate) : 0;
    const netProfit = roundToCents(grossProfit - incomeTax - tradeTax - solidarityTax);

    this.balance.taxReserve = incomeTax + tradeTax + solidarityTax;

    return {
      grossRevenue: revenue,
      netRevenue,
      vatAmount,
      vatRate,
      operatingCosts: expenses,
      grossProfit,
      incomeTax,
      tradeTax,
      solidarityTax,
      netProfit,
      period: { from: this.transactions[0]?.timestamp ?? new Date(), to: new Date() },
    };
  }

  calculateHealth(): FinancialHealth {
    const tax = this.calculateTax();
    const monthlyBurn = this.transactions
      .filter(t => t.type === 'expense' && t.category !== 'cost_of_goods')
      .reduce((sum, t) => sum + t.amount, 0);

    return {
      liquidityRatio: monthlyBurn > 0 ? this.balance.ownCapital / monthlyBurn : Infinity,
      debtToEquity: this.balance.totalBalance > 0 ? this.balance.foreignCapital / this.balance.totalBalance : 0,
      monthlyBurnRate: monthlyBurn,
      runwayMonths: monthlyBurn > 0 ? this.balance.ownCapital / monthlyBurn : Infinity,
      profitMargin: tax.grossProfit > 0 ? tax.netProfit / tax.grossProfit : 0,
      foreignCapitalRatio: this.balance.totalBalance > 0 ? this.balance.foreignCapital / this.balance.totalBalance : 0,
      taxComplianceScore: this.balance.taxReserve > 0 ? Math.min(this.balance.taxReserve / Math.max(tax.incomeTax + tax.tradeTax + tax.solidarityTax, 1), 1) : 0,
    };
  }

  getBalance(): BalanceState {
    return this.balance;
  }

  getTargetProgress(): { elapsedDays: number; profit: number; targetWeek2: number; target30d: number; percentWeek2: number; percent30d: number } {
    const tax = this.calculateTax();
    const firstTx = this.transactions[0]?.timestamp ?? new Date();
    const elapsedDays = (Date.now() - firstTx.getTime()) / 86400000;
    return {
      elapsedDays,
      profit: tax.netProfit,
      targetWeek2: TARGET_PROFIT_WEEK2,
      target30d: TARGET_PROFIT_30D,
      percentWeek2: (tax.netProfit / TARGET_PROFIT_WEEK2) * 100,
      percent30d: (tax.netProfit / TARGET_PROFIT_30D) * 100,
    };
  }

  getTransactions(): Transaction[] {
    return this.transactions;
  }
}