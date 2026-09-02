import { z } from 'zod';
import { BiReport, BiRecommendation, BudgetAllocation, ModuleId, DomainEvent, createDomainEvent } from '@fullautonom/shared';

// ============================================================================
// BI-Brain Service — Business Intelligence, Budget, Optimierung
// ============================================================================

export const ReportRequestSchema = z.object({
  type: z.enum(['daily', 'weekly', 'monthly', 'custom']),
  period: z.object({
    from: z.string(),
    to: z.string(),
  }).optional(),
});

export const BudgetAdjustSchema = z.object({
  moduleId: z.enum(['crm-intel', 'marketing-autopilot', 'ecommerce-core', 'fibu-autonomous', 'logistics-hub', 'bi-brain', 'osint-engine']),
  newAmount: z.number().positive(),
});

export const MetricReportSchema = z.object({
  moduleId: z.string(),
  metric: z.string(),
  value: z.number(),
});

const START_BUDGET = 0;
const TARGET_WEEK2_PROFIT = 500;
const TARGET_30D_PROFIT = 1000;

export class BusinessIntelligenceService {
  private reports: BiReport[] = [];
  private recommendations: BiRecommendation[] = [];
  private budgetAllocations: BudgetAllocation[] = [];
  private moduleInputs: Record<string, Record<string, number>> = {};
  private eventEmitter: (event: DomainEvent) => Promise<void> = async () => {};

  setEventEmitter(emitter: (event: DomainEvent) => Promise<void>) {
    this.eventEmitter = emitter;
  }

  recordModuleMetric(moduleId: string, metric: string, value: number): void {
    if (!this.moduleInputs[moduleId]) this.moduleInputs[moduleId] = {};
    this.moduleInputs[moduleId][metric] = value;
  }

  generateBusinessPlan(): Record<string, string> {
    return {
      phase1_first_week: 'Produktselektion (200-500 Genre-Produkte) + Shopware-Setup + CRM-Profile + OSINT-Scanning',
      phase2_second_week: 'Erste Dropship-Orders mit 65%+ Marge, organische Reache via Reddit/TikTok/Instagram',
      phase3_third_week: 'Skoierung: 3-5 Nischen pro Genre, Content-Matrix multiplizieren, Influencer-Clearing',
      phase4_fourth_week: '30-Tage Ziel: 1000€ Reingewinn, Wiederkauf-Kampagnen, CRM-Retention',
      budget_rule: '0€ Betriebskosten. Server läuft auf Workstation. Kein Ad-Spend.',
      profit_targets: `Woche2: ${TARGET_WEEK2_PROFIT}€ | 30 Tage: ${TARGET_30D_PROFIT}€`,
      niche_focus: 'Festival/DJ-Bekleidung: Uptempo, Hardcore, Rawstyle, Hardstyle, Djane',
      pricing_strategy: 'Charm-Pricing (.90), UVP-Hooks, 60-75% Marge',
      marketing_channels: 'Reddit (r/hardstyle, r/gabber), Instagram, TikTok, Spotify, Discord',
      free_ai_budget: '0€ via OmniRoute Free-Tier (Kiro, OpenCode, Groq, Qoder)',
    };
  }

  calculateBudgetAllocations(): BudgetAllocation[] {
    this.budgetAllocations = [
      { moduleId: 'crm-intel', allocated: 0, spent: 0, remaining: 0, roi: 3.5, period: '2026-09', currency: 'EUR' },
      { moduleId: 'marketing-autopilot', allocated: 0, spent: 0, remaining: 0, roi: 4.2, period: '2026-09', currency: 'EUR' },
      { moduleId: 'ecommerce-core', allocated: 0, spent: 0, remaining: 0, roi: 2.8, period: '2026-09', currency: 'EUR' },
      { moduleId: 'fibu-autonomous', allocated: 0, spent: 0, remaining: 0, roi: Infinity, period: '2026-09', currency: 'EUR' },
      { moduleId: 'logistics-hub', allocated: 0, spent: 0, remaining: 0, roi: 1.9, period: '2026-09', currency: 'EUR' },
      { moduleId: 'bi-brain', allocated: 0, spent: 0, remaining: 0, roi: Infinity, period: '2026-09', currency: 'EUR' },
      { moduleId: 'osint-engine', allocated: 0, spent: 0, remaining: 0, roi: 2.4, period: '2026-09', currency: 'EUR' },
    ];
    return this.budgetAllocations;
  }

  generateRecommendations(): BiRecommendation[] {
    this.recommendations = [
      {
        id: crypto.randomUUID(),
        moduleId: 'marketing-autopilot',
        priority: 'high',
        title: 'Reach-Nische: Musik-Genre-Hashtags',
        description: 'Posting-Zeiten auf Donnerstag-Samstag 18-22 Uhr fokussieren (hoechste Festival-Reach)',
        expectedImpact: 35,
        implementationEffort: 'low',
        status: 'pending',
        createdAt: new Date(),
      },
      {
        id: crypto.randomUUID(),
        moduleId: 'crm-intel',
        priority: 'high',
        title: 'Lead-Scoring aktivieren',
        description: 'HUMINT-Profile um Musikpraeferenzen & Influencer-Typen anreichern.',
        expectedImpact: 25,
        implementationEffort: 'low',
        status: 'pending',
        createdAt: new Date(),
      },
      {
        id: crypto.randomUUID(),
        moduleId: 'bi-brain',
        priority: 'medium',
        title: '30-Tage-Profit-Dashboard',
        description: 'live-Monitoring von Woche-2 & 30-Tage Zielerreichung.',
        expectedImpact: 40,
        implementationEffort: 'medium',
        status: 'pending',
        createdAt: new Date(),
      },
      {
        id: crypto.randomUUID(),
        moduleId: 'osint-engine',
        priority: 'high',
        title: 'Trend-basierte Produktanpassung',
        description: 'OSINT-Trends mit Produktbestand vergleichen → Content anpassen.',
        expectedImpact: 30,
        implementationEffort: 'low',
        status: 'pending',
        createdAt: new Date(),
      },
    ];
    return this.recommendations;
  }

  generateReport(type: 'daily' | 'weekly' | 'monthly' | 'custom'): BiReport {
    const totalRevenue = this.moduleInputs['fibu-autonomous']?.revenue ?? 0;
    const totalProfit = totalRevenue * 0.4;
    const report: BiReport = {
      id: crypto.randomUUID(),
      type,
      generatedAt: new Date(),
      period: { from: new Date(), to: new Date() },
      summary: `Total Profit (${type}): ${totalProfit.toFixed(2)}EUR. Fortschritt Richtung 30-Tage-Ziel: ${(totalProfit / TARGET_30D_PROFIT * 100).toFixed(0)}%`,
      metrics: {
        revenue: totalRevenue,
        profit: totalProfit,
        goal30d: TARGET_30D_PROFIT,
        goalWeek2: TARGET_WEEK2_PROFIT,
      },
      recommendations: this.recommendations,
      moduleScores: {
        'crm-intel': 85,
        'marketing-autopilot': 80,
        'ecommerce-core': 75,
        'fibu-autonomous': 90,
        'logistics-hub': 70,
        'bi-brain': 90,
        'osint-engine': 80,
        'omniroute-ai': 85,
        'api-gateway': 100,
        'data-lake': 95,
        'client-console': 0,
      },
    };
    this.reports.push(report);
    return report;
  }

  getReports(): BiReport[] {
    return this.reports;
  }

  getRecommendations(): BiRecommendation[] {
    return this.recommendations;
  }

  getBudget(): BudgetAllocation[] {
    return this.budgetAllocations.length ? this.budgetAllocations : this.calculateBudgetAllocations();
  }
}