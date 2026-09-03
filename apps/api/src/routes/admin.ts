import { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { users, roles, permissions, userRoles, rolePermissions } from '../schema.js';
import { eq, and, or } from 'drizzle-orm';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { hashPassword } from '../auth/password.js';
import { authenticate, requirePermission } from '../auth/middleware.js';
import { logAudit } from '../auth/audit.js';

const createUserSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_-]+$/),
  email: z.string().email(),
  password: z.string().min(12).max(128),
  fullName: z.string().max(200).optional(),
  roleIds: z.array(z.string().uuid()).optional(),
});

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  fullName: z.string().max(200).optional(),
  isActive: z.boolean().optional(),
});

const createRoleSchema = z.object({
  name: z.string().min(2).max(50).regex(/^[a-zA-Z0-9_-]+$/),
  description: z.string().max(200).optional(),
});

const assignRoleSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
});

const assignPermissionSchema = z.object({
  roleId: z.string().uuid(),
  permissionId: z.string().uuid(),
});

export async function adminRoutes(server: FastifyInstance) {
  // --- Users ---
  server.get('/api/admin/users', {
    preHandler: [authenticate, requirePermission('admin:read')],
  }, async (request, reply) => {
    const result = await db.select({
      id: users.id,
      username: users.username,
      email: users.email,
      fullName: users.fullName,
      isActive: users.isActive,
      isBootstrapAdmin: users.isBootstrapAdmin,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    }).from(users);

    return reply.send(result);
  });

  server.post('/api/admin/users', {
    preHandler: [authenticate, requirePermission('admin:write')],
  }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid user data', details: parsed.error.flatten() });
    }

    const { username, email, password, fullName, roleIds } = parsed.data;

    const existing = await db.select({ id: users.id })
      .from(users)
      .where(or(eq(users.username, username), eq(users.email, email)))
      .limit(1);

    if (existing.length) {
      return reply.status(409).send({ error: 'Username or email already exists' });
    }

    const passwordHash = await hashPassword(password);
    const userId = uuidv4();

    await db.insert(users).values({
      id: userId,
      username,
      email,
      passwordHash,
      fullName: fullName || null,
    });

    if (roleIds?.length) {
      for (const roleId of roleIds) {
        await db.insert(userRoles).values({
          id: uuidv4(),
          userId,
          roleId,
          assignedBy: request.user!.sub,
        });
      }
    }

    await logAudit({
      userId: request.user!.sub,
      action: 'user_created',
      entity: 'user',
      entityId: userId,
      newValue: { username, email, roleIds },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent']?.toString(),
      success: true,
    });

    return reply.status(201).send({ id: userId, username, email });
  });

  server.patch('/api/admin/users/:id', {
    preHandler: [authenticate, requirePermission('admin:write')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid data', details: parsed.error.flatten() });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.email !== undefined) updates.email = parsed.data.email;
    if (parsed.data.fullName !== undefined) updates.fullName = parsed.data.fullName;
    if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;

    const result = await db.update(users).set(updates).where(eq(users.id, id)).returning({ id: users.id });
    if (!result.length) {
      return reply.status(404).send({ error: 'User not found' });
    }

    await logAudit({
      userId: request.user!.sub,
      action: 'user_updated',
      entity: 'user',
      entityId: id,
      newValue: parsed.data,
      ipAddress: request.ip,
      success: true,
    });

    return reply.send({ id, message: 'User updated' });
  });

  server.post('/api/admin/users/:id/reset-password', {
    preHandler: [authenticate, requirePermission('admin:write')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const schema = z.object({ password: z.string().min(12).max(128) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid password' });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const result = await db.update(users).set({
      passwordHash,
      passwordChangedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(users.id, id)).returning({ id: users.id });

    if (!result.length) {
      return reply.status(404).send({ error: 'User not found' });
    }

    await logAudit({
      userId: request.user!.sub,
      action: 'admin_password_reset',
      entity: 'user',
      entityId: id,
      ipAddress: request.ip,
      success: true,
    });

    return reply.send({ message: 'Password reset' });
  });

  server.delete('/api/admin/users/:id', {
    preHandler: [authenticate, requirePermission('admin:write')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const user = await db.select({ id: users.id, isBootstrapAdmin: users.isBootstrapAdmin })
      .from(users).where(eq(users.id, id)).limit(1);

    if (!user.length) {
      return reply.status(404).send({ error: 'User not found' });
    }

    if (user[0].isBootstrapAdmin) {
      return reply.status(403).send({ error: 'Cannot delete bootstrap admin' });
    }

    await db.delete(users).where(eq(users.id, id));

    await logAudit({
      userId: request.user!.sub,
      action: 'user_deleted',
      entity: 'user',
      entityId: id,
      ipAddress: request.ip,
      success: true,
    });

    return reply.send({ message: 'User deleted' });
  });

  // --- Roles ---
  server.get('/api/admin/roles', {
    preHandler: [authenticate, requirePermission('admin:read')],
  }, async (request, reply) => {
    const result = await db.select().from(roles);
    return reply.send(result);
  });

  server.post('/api/admin/roles', {
    preHandler: [authenticate, requirePermission('admin:write')],
  }, async (request, reply) => {
    const parsed = createRoleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid role data', details: parsed.error.flatten() });
    }

    const { name, description } = parsed.data;
    const roleId = uuidv4();

    await db.insert(roles).values({ id: roleId, name, description: description || null });

    await logAudit({
      userId: request.user!.sub,
      action: 'role_created',
      entity: 'role',
      entityId: roleId,
      newValue: { name },
      ipAddress: request.ip,
      success: true,
    });

    return reply.status(201).send({ id: roleId, name });
  });

  server.delete('/api/admin/roles/:id', {
    preHandler: [authenticate, requirePermission('admin:write')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const role = await db.select({ id: roles.id, isSystem: roles.isSystem })
      .from(roles).where(eq(roles.id, id)).limit(1);

    if (!role.length) {
      return reply.status(404).send({ error: 'Role not found' });
    }

    if (role[0].isSystem) {
      return reply.status(403).send({ error: 'Cannot delete system role' });
    }

    await db.delete(roles).where(eq(roles.id, id));

    await logAudit({
      userId: request.user!.sub,
      action: 'role_deleted',
      entity: 'role',
      entityId: id,
      ipAddress: request.ip,
      success: true,
    });

    return reply.send({ message: 'Role deleted' });
  });

  // --- Permissions ---
  server.get('/api/admin/permissions', {
    preHandler: [authenticate, requirePermission('admin:read')],
  }, async (request, reply) => {
    const result = await db.select().from(permissions);
    return reply.send(result);
  });

  // --- User-Role assignments ---
  server.post('/api/admin/user-roles', {
    preHandler: [authenticate, requirePermission('admin:write')],
  }, async (request, reply) => {
    const parsed = assignRoleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid data', details: parsed.error.flatten() });
    }

    const { userId, roleId } = parsed.data;

    const existing = await db.select()
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)))
      .limit(1);

    if (existing.length) {
      return reply.status(409).send({ error: 'Role already assigned' });
    }

    await db.insert(userRoles).values({
      id: uuidv4(),
      userId,
      roleId,
      assignedBy: request.user!.sub,
    });

    return reply.status(201).send({ message: 'Role assigned' });
  });

  server.delete('/api/admin/user-roles', {
    preHandler: [authenticate, requirePermission('admin:write')],
  }, async (request, reply) => {
    const parsed = assignRoleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid data' });
    }

    const { userId, roleId } = parsed.data;
    await db.delete(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));

    return reply.send({ message: 'Role removed' });
  });

  // --- Role-Permission assignments ---
  server.post('/api/admin/role-permissions', {
    preHandler: [authenticate, requirePermission('admin:write')],
  }, async (request, reply) => {
    const parsed = assignPermissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid data', details: parsed.error.flatten() });
    }

    const { roleId, permissionId } = parsed.data;

    const existing = await db.select()
      .from(rolePermissions)
      .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, permissionId)))
      .limit(1);

    if (existing.length) {
      return reply.status(409).send({ error: 'Permission already assigned' });
    }

    await db.insert(rolePermissions).values({
      id: uuidv4(),
      roleId,
      permissionId,
    });

    return reply.status(201).send({ message: 'Permission assigned to role' });
  });

  server.delete('/api/admin/role-permissions', {
    preHandler: [authenticate, requirePermission('admin:write')],
  }, async (request, reply) => {
    const parsed = assignPermissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid data' });
    }

    const { roleId, permissionId } = parsed.data;
    await db.delete(rolePermissions)
      .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, permissionId)));

    return reply.send({ message: 'Permission removed from role' });
  });

  // --- Audit logs ---
  server.get('/api/admin/audit-logs', {
    preHandler: [authenticate, requirePermission('admin:read')],
  }, async (request, reply) => {
    const { getAuditLogs } = await import('../auth/audit.js');
    const query = request.query as Record<string, string>;
    const logs = await getAuditLogs({
      userId: query.userId,
      action: query.action,
      entity: query.entity,
      limit: query.limit ? parseInt(query.limit) : 100,
      offset: query.offset ? parseInt(query.offset) : 0,
    });
    return reply.send(logs);
  });
}
