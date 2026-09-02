import { db } from '../db.js';
import { sessions } from '../schema.js';
import { eq, and, lt } from 'drizzle-orm';
import { generateCSRFToken } from './jwt.js';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export async function createSession(userId: string): Promise<{ id: string; csrfToken: string; expiresAt: Date }> {
  const id = crypto.randomUUID();
  const csrfToken = generateCSRFToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(sessions).values({
    id,
    userId,
    csrfToken,
    expiresAt,
  });

  return { id, csrfToken, expiresAt };
}

export async function getSession(sessionId: string) {
  const result = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  return result[0] || null;
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
  const session = await getSession(sessionId);
  if (!session) return false;
  if (new Date() > session.expiresAt) {
    await deleteSession(sessionId);
    return false;
  }
  return session.csrfToken === csrfToken;
}

export async function rotateCSRFToken(sessionId: string): Promise<string> {
  const newToken = generateCSRFToken();
  await db.update(sessions)
    .set({ csrfToken: newToken })
    .where(eq(sessions.id, sessionId));
  return newToken;
}