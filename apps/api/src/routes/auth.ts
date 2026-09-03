import { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { users } from '../schema.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { verifyPassword, hashPassword, validatePasswordStrength } from '../auth/password.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken, type JWTPayload } from '../auth/jwt.js';
import { createSession, deleteSession, getSession, deleteUserSessions } from '../auth/session.js';
import { loadUserPermissions, authenticate } from '../auth/middleware.js';
import { logAudit } from '../auth/audit.js';

const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(128),
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
});

export async function authRoutes(server: FastifyInstance) {
  server.post('/api/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid credentials format' });
    }

    const { username, password } = parsed.data;
    const ip = request.ip;
    const userAgent = request.headers['user-agent']?.toString();

    const userResult = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    const user = userResult[0];

    if (!user) {
      await logAudit({
        action: 'login_failed',
        ipAddress: ip,
        userAgent,
        success: false,
        errorMessage: 'User not found',
      });
      return reply.status(401).send({ error: 'Ungültige Anmeldedaten' });
    }

    if (!user.isActive) {
      await logAudit({
        userId: user.id,
        action: 'login_failed',
        ipAddress: ip,
        userAgent,
        success: false,
        errorMessage: 'Account deactivated',
      });
      return reply.status(401).send({ error: 'Account ist deaktiviert' });
    }

    const passwordValid = await verifyPassword(user.passwordHash, password);
    if (!passwordValid) {
      await logAudit({
        userId: user.id,
        action: 'login_failed',
        ipAddress: ip,
        userAgent,
        success: false,
        errorMessage: 'Invalid password',
      });
      return reply.status(401).send({ error: 'Ungültige Anmeldedaten' });
    }

    const { roles, permissions } = await loadUserPermissions(user.id);
    const csrfToken = crypto.randomUUID();
    const accessToken = generateAccessToken(
      { sub: user.id, username: user.username, roles, permissions },
      csrfToken
    );
    const refreshToken = generateRefreshToken(user.id);
    const session = await createSession(user.id);

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    await logAudit({
      userId: user.id,
      action: 'login_success',
      ipAddress: ip,
      userAgent,
      success: true,
    });

    reply.setCookie('sessionId', session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });

    return reply.send({
      accessToken,
      refreshToken,
      csrfToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        roles,
        permissions,
      },
    });
  });

  server.post('/api/auth/logout', { preHandler: [authenticate] }, async (request, reply) => {
    const sessionId = request.cookies?.sessionId;
    if (sessionId) {
      await deleteSession(sessionId);
    }

    if (request.user) {
      await logAudit({
        userId: request.user.sub,
        action: 'logout',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent']?.toString(),
        success: true,
      });
    }

    reply.clearCookie('sessionId', { path: '/' });
    return reply.send({ message: 'Logged out' });
  });

  server.get('/api/auth/me', { preHandler: [authenticate] }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }

    const userResult = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        fullName: users.fullName,
        isActive: users.isActive,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, request.user.sub))
      .limit(1);

    if (!userResult.length) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return reply.send({
      ...userResult[0],
      roles: request.user.roles,
      permissions: request.user.permissions,
    });
  });

  server.post('/api/auth/refresh', async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken?: string };
    if (!refreshToken) {
      return reply.status(400).send({ error: 'Refresh token required' });
    }

    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      return reply.status(401).send({ error: 'Invalid or expired refresh token' });
    }

    const userResult = await db
      .select()
      .from(users)
      .where(eq(users.id, decoded.sub))
      .limit(1);

    const user = userResult[0];
    if (!user || !user.isActive) {
      return reply.status(401).send({ error: 'User not found or deactivated' });
    }

    const { roles, permissions } = await loadUserPermissions(user.id);
    const csrfToken = crypto.randomUUID();
    const newAccessToken = generateAccessToken(
      { sub: user.id, username: user.username, roles, permissions },
      csrfToken
    );
    const newRefreshToken = generateRefreshToken(user.id);

    return reply.send({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      csrfToken,
    });
  });

  server.patch('/api/auth/password', { preHandler: [authenticate] }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }

    const parsed = passwordChangeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid password data', details: parsed.error.flatten() });
    }

    const { currentPassword, newPassword } = parsed.data;

    const validation = validatePasswordStrength(newPassword);
    if (!validation.valid) {
      return reply.status(400).send({ error: 'Password too weak', details: validation.errors });
    }

    const userResult = await db
      .select()
      .from(users)
      .where(eq(users.id, request.user.sub))
      .limit(1);

    if (!userResult.length) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const user = userResult[0];
    const currentValid = await verifyPassword(user.passwordHash, currentPassword);
    if (!currentValid) {
      await logAudit({
        userId: user.id,
        action: 'password_change_failed',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent']?.toString(),
        success: false,
        errorMessage: 'Current password invalid',
      });
      return reply.status(401).send({ error: 'Aktuelles Passwort ist falsch' });
    }

    const newHash = await hashPassword(newPassword);
    await db.update(users).set({
      passwordHash: newHash,
      passwordChangedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(users.id, user.id));

    await deleteUserSessions(user.id);

    await logAudit({
      userId: user.id,
      action: 'password_changed',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent']?.toString(),
      success: true,
    });

    return reply.send({ message: 'Passwort erfolgreich geändert. Bitte erneut anmelden.' });
  });
}
