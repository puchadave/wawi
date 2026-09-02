import { db } from '../db.js';
import { securityAuditLog } from '../schema.js';

export interface AuditLogEntry {
  userId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
}

export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    await db.insert(securityAuditLog).values({
      id: crypto.randomUUID(),
      userId: entry.userId || null,
      action: entry.action,
      entity: entry.entity || null,
      entityId: entry.entityId || null,
      oldValue: entry.oldValue || null,
      newValue: entry.newValue || null,
      ipAddress: entry.ipAddress || null,
      userAgent: entry.userAgent || null,
      success: entry.success,
      errorMessage: entry.errorMessage || null,
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}

export async function getAuditLogs(filters?: {
  userId?: string;
  action?: string;
  entity?: string;
  entityId?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}) {
  const conditions = [];
  if (filters?.userId) conditions.push(eq(securityAuditLog.userId, filters.userId));
  if (filters?.action) conditions.push(eq(securityAuditLog.action, filters.action));
  if (filters?.entity) conditions.push(eq(securityAuditLog.entity, filters.entity));
  if (filters?.entityId) conditions.push(eq(securityAuditLog.entityId, filters.entityId));
  if (filters?.fromDate) conditions.push(gte(securityAuditLog.createdAt, filters.fromDate));
  if (filters?.toDate) conditions.push(lte(securityAuditLog.createdAt, filters.toDate));

  const { gte, lte } = await import('drizzle-orm');
  const where = conditions.length ? and(...conditions) : undefined;

  return db.select().from(securityAuditLog)
    .where(where)
    .orderBy(desc(securityAuditLog.createdAt))
    .limit(filters?.limit || 100)
    .offset(filters?.offset || 0);
}

import { eq, and, gte, lte, desc } from 'drizzle-orm';