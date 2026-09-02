// ============================================================================
// @fullautonom/shared — Zentrale Types für alle Module
// ============================================================================

export type ModuleId =
  | 'api-gateway'
  | 'crm-intel'
  | 'marketing-autopilot'
  | 'ecommerce-core'
  | 'fibu-autonomous'
  | 'logistics-hub'
  | 'bi-brain'
  | 'osint-engine'
  | 'omniroute-ai'
  | 'data-lake'
  | 'client-console';

export interface ModuleConfig {
  id: ModuleId;
  port: number;
  host: string;
  redisUrl: string;
  databaseUrl: string;
  apiKey?: string;
  aiGatewayUrl?: string;
}

export interface ModuleHealth {
  moduleId: ModuleId;
  status: 'healthy' | 'degraded' | 'down';
  uptime: number;
  lastCheck: Date;
  metrics: ModuleMetrics;
}

export interface ModuleMetrics {
  requestsTotal: number;
  requestsPerMinute: number;
  avgResponseTimeMs: number;
  errorRate: number;
  memoryUsageMb: number;
  cpuUsagePercent: number;
}

export interface ServiceEndpoint {
  moduleId: ModuleId;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  description: string;
  rateLimit?: number;
}

// ============================================================================
// Event Types — Redis PubSub / BullMQ
// ============================================================================

export type EventType =
  | 'order.created'
  | 'order.paid'
  | 'order.shipped'
  | 'order.completed'
  | 'order.returned'
  | 'product.imported'
  | 'product.updated'
  | 'product.out_of_stock'
  | 'stock.changed'
  | 'price.changed'
  | 'payment.received'
  | 'payment.forwarded'
  | 'customer.created'
  | 'customer.profiled'
  | 'lead.generated'
  | 'content.generated'
  | 'content.posted'
  | 'osint.alert'
  | 'osint.trend_detected'
  | 'bi.optimization_ready'
  | 'bi.budget_adjustment'
  | 'fibu.balance_alert'
  | 'fibu.tax_ready'
  | 'logistics.supplier_order_created'
  | 'logistics.supplier_order_shipped'
  | 'logistics.return_received'
  | 'marketing.campaign_started'
  | 'marketing.campaign_completed';

export interface DomainEvent<T = unknown> {
  id: string;
  type: EventType;
  source: ModuleId;
  timestamp: Date;
  payload: T;
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

// ============================================================================
// Customer & CRM Types
// ============================================================================

export interface CustomerProfile {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  createdAt: Date;
  updatedAt: Date;
  socialProfiles: SocialProfile[];
  humintProfile?: HumintProfile;
  preferences: CustomerPreferences;
  tags: string[];
  leadScore: number;
  segment: CustomerSegment;
  isLead: boolean;
  source: 'organic' | 'paid' | 'referral' | 'osint' | 'manual';
}

export interface SocialProfile {
  platform: 'instagram' | 'tiktok' | 'facebook' | 'twitter' | 'youtube' | 'discord' | 'spotify' | 'pinterest';
  handle: string;
  url: string;
  followers?: number;
  engagementRate?: number;
  interests: string[];
  hashtags: string[];
  lastAnalyzed: Date;
  isVerified: boolean;
}

export interface HumintProfile {
  communicationStyle: 'formal' | 'casual' | 'enthusiastic' | 'minimal' | 'technical';
  musicPreferences: string[];
  festivalHistory: string[];
  buyingTriggers: string[];
  priceSensitivity: 'low' | 'medium' | 'high';
  brandAffinities: string[];
  influencerType: 'follower' | 'micro_influencer' | 'macro_influencer' | 'nano_influencer' | 'none';
  notes: string[];
  lastUpdated: Date;
}

export interface CustomerPreferences {
  languages: string[];
  currencies: string[];
  notificationChannels: ('email' | 'sms' | 'push' | 'whatsapp' | 'discord')[];
  musicGenres: string[];
  favoriteArtists: string[];
  sizes: Record<string, string>;
  preferredContactTime?: string;
}

export type CustomerSegment =
  | 'vip'
  | 'returning'
  | 'new'
  | 'at_risk'
  | 'dormant'
  | 'lead'
  | 'prospect'
  | 'champion';

// ============================================================================
// Marketing Types
// ============================================================================

export interface MarketingCampaign {
  id: string;
  name: string;
  type: 'social_post' | 'email' | 'ad' | 'content' | 'influencer' | 'newsletter';
  status: 'draft' | 'scheduled' | 'active' | 'paused' | 'completed' | 'archived';
  platforms: string[];
  content: MarketingContent;
  targetAudience: AudienceFilter;
  schedule?: ScheduleConfig;
  metrics: CampaignMetrics;
  budget?: number;
  spent?: number;
}

export interface MarketingContent {
  id: string;
  title: string;
  body: string;
  hashtags: string[];
  mediaUrls: string[];
  cta?: string;
  generatedBy: 'ai' | 'manual' | 'hybrid';
  aiModel?: string;
  comboName?: string;
  createdAt: Date;
  variant?: string;
}

export interface AudienceFilter {
  segments: CustomerSegment[];
  musicGenres: string[];
  ageRange?: [number, number];
  locations?: string[];
  interests?: string[];
  minLeadScore?: number;
  maxLeadScore?: number;
}

export interface ScheduleConfig {
  frequency: 'once' | 'daily' | 'weekly' | 'custom' | 'optimal';
  times: string[];
  timezone: string;
  optimalPostingTimes?: string[];
  startDate?: Date;
  endDate?: Date;
}

export interface CampaignMetrics {
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  ctr: number;
  conversionRate: number;
  roi: number;
  costPerAcquisition?: number;
}

// ============================================================================
// Financial Types (FiBu)
// ============================================================================

export interface Transaction {
  id: string;
  type: 'income' | 'expense' | 'transfer' | 'tax';
  amount: number;
  currency: string;
  description: string;
  category: string;
  reference?: string;
  orderId?: string;
  supplierId?: string;
  timestamp: Date;
  processedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface BalanceState {
  totalBalance: number;
  foreignCapital: number;
  ownCapital: number;
  taxReserve: number;
  lastUpdated: Date;
  maxForeignCapitalDurationMs: number;
  foreignCapitalEntries: ForeignCapitalEntry[];
}

export interface ForeignCapitalEntry {
  id: string;
  amount: number;
  source: string;
  receivedAt: Date;
  forwardedAt?: Date;
  destination?: string;
  durationMs?: number;
}

export interface TaxCalculation {
  grossRevenue: number;
  netRevenue: number;
  vatAmount: number;
  vatRate: number;
  operatingCosts: number;
  grossProfit: number;
  incomeTax: number;
  tradeTax: number;
  solidarityTax: number;
  netProfit: number;
  period: { from: Date; to: Date };
}

export interface FinancialHealth {
  liquidityRatio: number;
  debtToEquity: number;
  monthlyBurnRate: number;
  runwayMonths: number;
  profitMargin: number;
  foreignCapitalRatio: number;
  taxComplianceScore: number;
}

export interface PricingRule {
  id: string;
  name: string;
  vatRate: number;
  targetMargin: number;
  fixedSurchargeNet: number;
  mode: 'netto' | 'brutto';
  charmPricing: boolean;
  includeFreightInVk: boolean;
  charmThresholds: number[];
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Logistics Types (Dropshipping)
// ============================================================================

export interface Supplier {
  id: string;
  name: string;
  apiEndpoint?: string;
  apiKey?: string;
  type: 'api' | 'xml' | 'csv' | 'manual' | 'matterhorn';
  industries: string[];
  leadTimeDays: number;
  shippingZones: string[];
  returnPolicy: string;
  paymentTerms: string;
  reliabilityScore: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupplierOrder {
  id: string;
  supplierId: string;
  orderId: string;
  items: OrderItem[];
  totalAmount: number;
  status: 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'returned' | 'cancelled';
  trackingNumber?: string;
  trackingUrl?: string;
  estimatedDelivery: Date;
  actualDelivery?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItem {
  productId: string;
  variantId: string;
  quantity: number;
  unitPrice: number;
  ean?: string;
  attributes?: Record<string, string>;
}

export interface ShippingRate {
  carrier: string;
  zone: string;
  weightClass: string;
  price: number;
  leadDays: number;
  supplierId?: string;
}

// ============================================================================
// Product Types
// ============================================================================

export interface NicheProduct {
  id: string;
  title: string;
  description: string;
  brand: string;
  category: string;
  subcategory: string;
  genres: string[];
  images: string[];
  variants: ProductVariant[];
  pricing: ProductPricing;
  seo: SeoData;
  status: 'draft' | 'active' | 'paused' | 'archived';
  shopwareId?: string;
  supplierIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductVariant {
  id: string;
  name: string;
  sku: string;
  ean?: string;
  stock: number;
  reservedStock: number;
  attributes: Record<string, string>;
  images?: string[];
}

export interface ProductPricing {
  supplierNet: number;
  dropshipFee: number;
  freightCost: number;
  shopEkNet: number;
  shopVkNet: number;
  shopVkGross: number;
  margin: number;
  uvp?: number;
  currency: string;
}

export interface SeoData {
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  slug: string;
  structuredData?: Record<string, unknown>;
  canonicalUrl?: string;
}

// ============================================================================
// OSINT Types
// ============================================================================

export interface OsintTrend {
  id: string;
  source: 'reddit' | 'spotify' | 'youtube' | 'tiktok' | 'instagram' | 'all';
  niche: string;
  keywords: string[];
  sentiment: number;
  volume: number;
  trend: 'rising' | 'stable' | 'declining';
  discoveredAt: Date;
  expiresAt: Date;
}

export interface OsintTarget {
  id: string;
  type: 'competitor' | 'trend' | 'influencer' | 'hashtag' | 'platform' | 'keyword';
  query: string;
  platforms: string[];
  lastScan: Date;
  frequency: number;
  isActive: boolean;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface OsintResult {
  targetId: string;
  source: string;
  data: Record<string, unknown>;
  confidence: number;
  timestamp: Date;
}

export interface TrendData {
  keyword: string;
  platform: string;
  volume: number;
  growth: number;
  sentiment: number;
  relatedTerms: string[];
  detectedAt: Date;
  geo?: string;
}

export interface CompetitorData {
  name: string;
  url: string;
  prices: Record<string, number>;
  assortment: string[];
  traffic: number;
  socialFollowing: Record<string, number>;
  lastAnalyzed: Date;
  strengths: string[];
  weaknesses: string[];
}

// ============================================================================
// BI Types
// ============================================================================

export interface BiReport {
  id: string;
  type: 'daily' | 'weekly' | 'monthly' | 'custom';
  generatedAt: Date;
  period: { from: Date; to: Date };
  summary: string;
  metrics: Record<string, number>;
  recommendations: BiRecommendation[];
  moduleScores: Record<ModuleId, number>;
}

export interface BiRecommendation {
  id: string;
  moduleId: ModuleId;
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  expectedImpact: number;
  implementationEffort: 'low' | 'medium' | 'high';
  status: 'pending' | 'accepted' | 'implemented' | 'rejected' | 'deferred';
  createdAt: Date;
  implementedAt?: Date;
}

export interface BudgetAllocation {
  moduleId: ModuleId;
  allocated: number;
  spent: number;
  remaining: number;
  roi: number;
  period: string;
  currency: string;
}

// ============================================================================
// Utility Types
// ============================================================================

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}