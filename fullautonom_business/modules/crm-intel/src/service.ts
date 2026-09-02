import { z } from 'zod';
import { CustomerProfile, SocialProfile, HumintProfile, CustomerSegment, DomainEvent, createDomainEvent } from '@fullautonom/shared';

// ============================================================================
// Zod Schemas
// ============================================================================

export const CreateCustomerSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  tags: z.array(z.string()).default([]),
  source: z.enum(['organic', 'paid', 'referral', 'osint', 'manual']).default('manual'),
});

export const SocialProfileSchema = z.object({
  platform: z.enum(['instagram', 'tiktok', 'facebook', 'twitter', 'youtube', 'discord', 'spotify', 'pinterest']),
  handle: z.string(),
  url: z.string().url(),
  followers: z.number().optional(),
  engagementRate: z.number().optional(),
  interests: z.array(z.string()).default([]),
  hashtags: z.array(z.string()).default([]),
});

export const HumintProfileSchema = z.object({
  communicationStyle: z.enum(['formal', 'casual', 'enthusiastic', 'minimal', 'technical']),
  musicPreferences: z.array(z.string()),
  festivalHistory: z.array(z.string()),
  buyingTriggers: z.array(z.string()),
  priceSensitivity: z.enum(['low', 'medium', 'high']),
  brandAffinities: z.array(z.string()),
  influencerType: z.enum(['follower', 'micro_influencer', 'macro_influencer', 'nano_influencer', 'none']),
  notes: z.array(z.string()),
});

export const LeadGenerateSchema = z.object({
  musicGenres: z.array(z.string()),
  platforms: z.array(z.string()),
  hashtags: z.array(z.string()),
  minFollowers: z.number().default(100),
  maxFollowers: z.number().default(50000),
  minEngagement: z.number().default(1),
});

// ============================================================================
// CRM-Intel Service
// ============================================================================

export class CrmIntelService {
  private profiles = new Map<string, CustomerProfile>();
  private leads = new Map<string, CustomerProfile>();
  private eventEmitter: (event: DomainEvent) => Promise<void> = async () => {};

  setEventEmitter(emitter: (event: DomainEvent) => Promise<void>) {
    this.eventEmitter = emitter;
  }

  async createCustomer(data: z.infer<typeof CreateCustomerSchema>): Promise<CustomerProfile> {
    const profile: CustomerProfile = {
      id: crypto.randomUUID(),
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      createdAt: new Date(),
      updatedAt: new Date(),
      socialProfiles: [],
      preferences: {
        languages: ['de'],
        currencies: ['EUR'],
        notificationChannels: ['email'],
        musicGenres: [],
        favoriteArtists: [],
        sizes: {},
      },
      tags: data.tags,
      leadScore: 0,
      segment: 'new',
      isLead: data.source === 'osint' || data.source === 'referral',
      source: data.source,
    };
    this.profiles.set(profile.id, profile);
    await this.eventEmitter(createDomainEvent('customer.created', 'crm-intel', { customerId: profile.id }));
    return profile;
  }

  async getCustomer(id: string): Promise<CustomerProfile | undefined> {
    return this.profiles.get(id);
  }

  async listCustomers(filters?: { segment?: CustomerSegment; isLead?: boolean }): Promise<CustomerProfile[]> {
    let customers = Array.from(this.profiles.values());
    if (filters?.segment) customers = customers.filter(c => c.segment === filters.segment);
    if (filters?.isLead !== undefined) customers = customers.filter(c => c.isLead === filters.isLead);
    return customers.sort((a, b) => b.leadScore - a.leadScore);
  }

  async addSocialProfile(customerId: string, socialData: z.infer<typeof SocialProfileSchema>): Promise<SocialProfile> {
    const profile = this.profiles.get(customerId);
    if (!profile) throw new Error(`Customer ${customerId} not found`);

    const socialProfile: SocialProfile = {
      ...socialData,
      lastAnalyzed: new Date(),
      isVerified: false,
    };
    profile.socialProfiles.push(socialProfile);
    profile.updatedAt = new Date();
    profile.leadScore = this.calculateLeadScore(profile);
    profile.segment = this.determineSegment(profile);
    await this.eventEmitter(createDomainEvent('customer.profiled', 'crm-intel', { customerId, profile: socialProfile }));
    return socialProfile;
  }

  async updateHumintProfile(customerId: string, humintData: z.infer<typeof HumintProfileSchema>): Promise<HumintProfile> {
    const profile = this.profiles.get(customerId);
    if (!profile) throw new Error(`Customer ${customerId} not found`);

    const humintProfile: HumintProfile = {
      ...humintData,
      lastUpdated: new Date(),
    };
    profile.humintProfile = humintProfile;
    profile.updatedAt = new Date();
    profile.preferences.musicGenres = [...new Set([...profile.preferences.musicGenres, ...humintData.musicPreferences])];
    profile.leadScore = this.calculateLeadScore(profile);
    profile.segment = this.determineSegment(profile);
    return humintProfile;
  }

  async getLeads(filters: { musicGenres?: string[]; segment?: CustomerSegment; minScore?: number } = {}): Promise<CustomerProfile[]> {
    let leads = Array.from(this.leads.values());
    if (filters.musicGenres?.length) {
      leads = leads.filter(l => l.preferences.musicGenres.some(g => filters.musicGenres!.includes(g)));
    }
    if (filters.segment) leads = leads.filter(l => l.segment === filters.segment);
    if (filters.minScore) leads = leads.filter(l => l.leadScore >= filters.minScore!);
    return leads.sort((a, b) => b.leadScore - a.leadScore);
  }

  async generateLeadFromOsint(osintData: {
    platform: string;
    handle: string;
    followers: number;
    engagementRate: number;
    interests: string[];
    hashtags: string[];
  }): Promise<CustomerProfile> {
    const existingLead = Array.from(this.leads.values()).find(
      l => l.socialProfiles.some(sp => sp.handle === osintData.handle)
    );

    if (existingLead) {
      existingLead.leadScore = this.calculateLeadScore(existingLead);
      return existingLead;
    }

    const lead: CustomerProfile = {
      id: crypto.randomUUID(),
      email: '',
      createdAt: new Date(),
      updatedAt: new Date(),
      socialProfiles: [{
        platform: osintData.platform as SocialProfile['platform'],
        handle: osintData.handle,
        url: '',
        followers: osintData.followers,
        engagementRate: osintData.engagementRate,
        interests: osintData.interests,
        hashtags: osintData.hashtags,
        lastAnalyzed: new Date(),
        isVerified: false,
      }],
      preferences: {
        languages: ['de'],
        currencies: ['EUR'],
        notificationChannels: [],
        musicGenres: osintData.interests,
        favoriteArtists: [],
        sizes: {},
      },
      tags: ['osint-generated'],
      leadScore: 0,
      segment: 'lead',
      isLead: true,
      source: 'osint',
    };

    lead.leadScore = this.calculateLeadScore(lead);
    this.leads.set(lead.id, lead);
    await this.eventEmitter(createDomainEvent('lead.generated', 'crm-intel', { leadId: lead.id }));
    return lead;
  }

  private calculateLeadScore(profile: CustomerProfile): number {
    const totalFollowers = profile.socialProfiles.reduce((sum, sp) => sum + (sp.followers || 0), 0);
    const avgEngagement = profile.socialProfiles.reduce((sum, sp) => sum + (sp.engagementRate || 0), 0) / Math.max(profile.socialProfiles.length, 1);
    const hasHumint = profile.humintProfile ? 20 : 0;
    const followerScore = Math.min(totalFollowers / 1000, 30);
    const engagementScore = Math.min(avgEngagement * 10, 30);
    const tagScore = Math.min(profile.tags.length * 5, 20);
    return Math.round(followerScore + engagementScore + hasHumint + tagScore);
  }

  private determineSegment(profile: CustomerProfile): CustomerSegment {
    if (profile.leadScore >= 80) return 'vip';
    if (profile.leadScore >= 50) return 'returning';
    if (profile.leadScore >= 20) return 'new';
    if (profile.leadScore >= 10) return 'prospect';
    return 'lead';
  }
}