import { z } from 'zod';
import { MarketingCampaign, MarketingContent, AudienceFilter, CampaignMetrics, DomainEvent, createDomainEvent } from '@fullautonom/shared';

// ============================================================================
// Zod Schemas
// ============================================================================

export const ContentRequestSchema = z.object({
  genre: z.string(),
  product: z.object({
    title: z.string(),
    brand: z.string().optional(),
    description: z.string().optional(),
    price: z.number().optional(),
  }),
  tone: z.enum(['energetic', 'promotional', 'authentic', 'festival', 'rnb']).default('festival'),
  platforms: z.array(z.enum(['instagram', 'tiktok', 'facebook', 'twitter', 'discord'])).default(['instagram']),
  comboName: z.string().optional(),
});

export const CampaignCreateSchema = z.object({
  name: z.string(),
  type: z.enum(['social_post', 'email', 'ad', 'content', 'influencer', 'newsletter']),
  platforms: z.array(z.string()),
  targetAudience: z.object({
    segments: z.array(z.enum(['vip', 'returning', 'new', 'at_risk', 'dormant', 'lead', 'prospect', 'champion'])),
    musicGenres: z.array(z.string()),
    ageRange: z.tuple([z.number(), z.number()]).optional(),
    locations: z.array(z.string()).optional(),
    interests: z.array(z.string()).optional(),
    minLeadScore: z.number().optional(),
    maxLeadScore: z.number().optional(),
  }),
  budget: z.number().optional(),
  schedule: z.object({
    frequency: z.enum(['once', 'daily', 'weekly', 'custom', 'optimal']),
    times: z.array(z.string()),
    timezone: z.string().default('Europe/Berlin'),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }).optional(),
});

export const PostContentSchema = z.object({
  contentId: z.string(),
  platforms: z.array(z.string()),
  scheduledAt: z.string().optional(),
});

// ============================================================================
// Marketing Autopilot Service
// ============================================================================

const GENRE_HASHTAGS: Record<string, string[]> = {
  uptempo: ['#uptempo', '#uptempohardcore', '#uptemorave', '#harderserenes', '#hardcoremusic'],
  hardcore: ['#hardcore', '#gabber', '#hardcoremusic', '#thunderdome', '#hardstyle'],
  rawstyle: ['#rawstyle', '#rawhardstyle', '#hardstylemusic', '#rave', '#hardtechno'],
  hardstyle: ['#hardstyle', '#hardstylefamily', '#hardstylemusic', '#quintino', '#rave'],
  'hardcore-techno': ['#hardcoretechno', '#hardtechno', '#technorave', '#industrial'],
  festival: ['#festivals', '#raveculture', '#raveoutfit', '#festivalfits', '#fashion'],
  djane: ['#djane', '#female dj', '#womenindj', '#hardstyledjane'],
};

const GENRE_EMOJIS: Record<string, string[]> = {
  uptempo: ['⚡', '🔥', '💥', '🎧'],
  hardcore: ['👊', '🖤', '💀', '🔊'],
  rawstyle: ['🧨', '⚙️', '🥁', '🎛️'],
  hardstyle: ['🎧', '💣', '🏆', '🎪'],
  festival: ['🎪', '✨', '🌟', '🌈'],
  djane: ['👑', '🎧', '💃', '✨'],
};

export class MarketingAutopilotService {
  private campaigns: MarketingCampaign[] = [];
  private contentLog: MarketingContent[] = [];
  private eventEmitter: (event: DomainEvent) => Promise<void> = async () => {};

  setEventEmitter(emitter: (event: DomainEvent) => Promise<void>) {
    this.eventEmitter = emitter;
  }

  async generateContent(req: z.infer<typeof ContentRequestSchema>): Promise<MarketingContent> {
    const hashtags = this.buildHashtags(req.genre, req.product.title);
    const emoji = this.pickEmoji(req.genre);
    const body = this.composeBody(req);
    const title = this.composeTitle(req);

    const content: MarketingContent = {
      id: crypto.randomUUID(),
      title,
      body,
      hashtags,
      mediaUrls: [],
      cta: this.composeCta(req.tone),
      generatedBy: 'ai',
      aiModel: req.comboName || 'vironne-content-engine',
      comboName: req.comboName,
      createdAt: new Date(),
    };

    this.contentLog.push(content);
    await this.eventEmitter(createDomainEvent('content.generated', 'marketing-autopilot', { contentId: content.id }));
    return content;
  }

  private buildHashtags(genre: string, productTitle: string): string[] {
    const core = GENRE_HASHTAGS[genre] ?? GENRE_HASHTAGS.festival;
    const productWords = productTitle.split(' ').slice(0, 2).map(w => w.replace(/[^\w]/g, ''));
    const productTags = productWords.filter(w => w.length > 3).map(w => `#${w.toLowerCase()}`);
    return [...new Set([...core, ...productTags, '#ravewear', '#festivalstyle', '#hardstylefashion'])].slice(0, 15);
  }

  private pickEmoji(genre: string): string {
    const pool = GENRE_EMOJIS[genre] ?? GENRE_EMOJIS.festival;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private composeTitle(req: z.infer<typeof ContentRequestSchema>): string {
    const brand = req.product.brand ?? '';
    return `${brand} ${req.product.title} - bereit für die Bühne ${req.genre.toUpperCase()} `;
  }

  private composeBody(req: z.infer<typeof ContentRequestSchema>): string {
    const toneLead = {
      energetic: `NEXT LEVEL ENERGY.`,
      promotional: `JETZT SICHERN - solange der Vorrat reicht!`,
      authentic: `Für alle, die es live erleben wollen.`,
      festival: `Festivalsaison ist da.`,
      rnb: `Sound, der bleibt. Style, der bleibt.`,
    }[req.tone];

    const priceLine = req.product.price ? `\n\n📍 Ab ${req.product.price.toFixed(2)}€` : '';

    return [
      toneLead,
      `\n${req.product.title}${req.product.brand ? ` von ${req.product.brand}` : ''} - designed für ${req.genre} Fans.`,
      `\nSweatproof. Langlebig. Einzigartig.`,
      priceLine,
      `\n\nLink in Bio 🔗`,
    ].join('');
  }

  private composeCta(tone: z.infer<typeof ContentRequestSchema>['tone']): string {
    return {
      energetic: 'Jetzt euer Outfit sichern 👊',
      promotional: 'Schnell sein - nur solange verfügbar!',
      authentic: 'Werdet Teil der Movement.',
      festival: 'Seid bereit für euer nächstes Festival.',
      rnb: 'Style, der euch definiert.',
    }[tone];
  }

  getOptimalPostingTimes(): string[] {
    return ['12:00', '15:00', '18:00', '19:00', '20:00', '21:00', '22:00'];
  }

  createCampaign(data: z.infer<typeof CampaignCreateSchema>): MarketingCampaign {
    const campaign: MarketingCampaign = {
      id: crypto.randomUUID(),
      name: data.name,
      type: data.type,
      status: 'draft',
      platforms: data.platforms,
      content: {
        id: crypto.randomUUID(),
        title: '',
        body: '',
        hashtags: this.buildHashtags(data.targetAudience.musicGenres[0] ?? 'festival', data.name),
        mediaUrls: [],
        generatedBy: 'ai',
        createdAt: new Date(),
      },
      targetAudience: data.targetAudience,
      schedule: data.schedule ? {
        ...data.schedule,
        startDate: data.schedule.startDate ? new Date(data.schedule.startDate) : undefined,
        endDate: data.schedule.endDate ? new Date(data.schedule.endDate) : undefined,
      } : {
        frequency: 'daily',
        times: this.getOptimalPostingTimes().slice(0, 2),
        timezone: 'Europe/Berlin',
      },
      metrics: this.emptyMetrics(),
      budget: data.budget,
      spent: 0,
    };
    this.campaigns.push(campaign);
    return campaign;
  }

  private emptyMetrics(): CampaignMetrics {
    return { impressions: 0, clicks: 0, conversions: 0, revenue: 0, ctr: 0, conversionRate: 0, roi: 0 };
  }

  getCampaigns(): MarketingCampaign[] {
    return this.campaigns;
  }

  getContentLog(): MarketingContent[] {
    return this.contentLog;
  }

  async schedulePost(contentId: string, platforms: string[], scheduledAt?: Date): Promise<void> {
    const content = this.contentLog.find(c => c.id === contentId);
    if (!content) throw new Error(`Content ${contentId} not found`);
    await this.eventEmitter(createDomainEvent('content.posted', 'marketing-autopilot', { contentId, platforms }));
  }
}