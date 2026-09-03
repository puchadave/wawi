import { db } from '../db.js';
import { sessions } from '../schema.js';
import { eq, and, lt } from 'drizzle-orm';
import { generateCSRFToken } from './jwt.js';

// BSI-201 Empfehlung: 24 Stunden Session-TTL
const SESSION_TTL_MS = 1000 * 60 * 60 * 24; // 24 Stunden
const SESSION_ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // Max 7 Tage absolut
const SESSION_IDLE_TTL_MS = 1000 * 60 * 30; // 30 Minuten Inaktivität

export async function createSession(userId: string, absoluteExpiry?: Date): Promise<{ id: string; csrfToken: string; expiresAt: Date; absoluteExpiresAt: Date }> {
  const id = crypto.randomUUID();
  const csrfToken = generateCSRFToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const absoluteExpiresAt = absoluteExpiry || new Date(Date.now() + SESSION_ABSOLUTE_TTL_MS);

  await db.insert(sessions).values({
    id,
    userId,
    csrfToken,
    expiresAt,
  });

  return { id, csrfToken, expiresAt, absoluteExpiresAt };
}

export async function getSession(sessionId: string) {
  if (!sessionId || sessionId.length > 100) return null;
  
  const result = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  const session = result[0] || null;
  
  if (session && new Date() > session.expiresAt) {
    await deleteSession(sessionId);
    return null;
  }
  
  return session;
}

export async function getUserSessions(userId: string) {
  return db.select().from(sessions).where(eq(sessions.userId, userId));
}

export async function deleteSession(sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function deleteUserSessions(userId: string, exceptSessionId?: string) {
  if (exceptSessionId) {
    await db.delete(sessions).where(and(eq(sessions.userId, userId), eq(sessions.id, exceptSessionId)));
  } else {
    await db.delete(sessions).where(eq(sessions.userId, userId));
  }
}

export async function cleanupExpiredSessions() {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export async function validateCSRFToken(sessionId: string, csrfToken: string): Promise<boolean> {
  if (!sessionId || !csrfToken || csrfToken.length !== 64) return false;
  
  const session = await getSession(sessionId);
  if (!session) return false;
  
  const isValid = session.csrfToken === csrfToken;
  
  if (isValid) {
    // Session bei erfolgreicher Validierung erneuern (sliding window)
    const newExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.update(sessions)
      .set({ expiresAt: newExpiresAt })
      .where(eq(sessions.id, sessionId));
  }
  
  return isValid;
}