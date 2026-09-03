import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken, type JWTPayload } from './jwt.js';
import { db } from '../db.js';
import { users, userRoles, roles, rolePermissions, permissions } from '../schema.js';
import { eq } from 'drizzle-orm';

declare module 'fastify' {
  interface FastifyRequest {
    user: JWTPayload | null;
  }
}

export interface PermissionRow {
  permissionName: string;
}

async function loadUserPermissions(userId: string): Promise<{ roles: string[]; permissions: string[] }> {
  const userWithRoles = await db
    .select({
      roleName: roles.name,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  const roleNames = userWithRoles.map((r) => r.roleName);

  if (roleNames.length === 0) {
    return { roles: [], permissions: [] };
  }

  const permRows = await db
    .select({ permissionName: permissions.name })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .innerJoin(roles, eq(rolePermissions.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  const uniquePerms = [...new Set(permRows.map((p) => p.permissionName))];

  return { roles: roleNames, permissions: uniquePerms };
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  request.user = null;

  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Authentication required' });
  }

  const token = authHeader.slice(7);
  const payload = verifyAccessToken(token);
  if (!payload) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }

  const userResult = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, payload.sub))
    .limit(1);

  if (!userResult.length || !userResult[0].isActive) {
    return reply.status(401).send({ error: 'User not found or deactivated' });
  }

  request.user = payload;
}

export function requirePermission(...requiredPermissions: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    const hasPermission = requiredPermissions.some(
      (perm) => request.user!.permissions.includes(perm) || request.user!.roles.includes('admin')
    );

    if (!hasPermission) {
      return reply.status(403).send({
        error: 'Insufficient permissions',
        required: requiredPermissions,
      });
    }
  };
}

export { loadUserPermissions };
