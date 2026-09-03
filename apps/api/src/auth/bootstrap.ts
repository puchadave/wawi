import { db } from '../db.js';
import { users, roles, permissions, userRoles, rolePermissions } from '../schema.js';
import { eq } from 'drizzle-orm';
import { hashPassword, generateSecurePassword } from './password.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PERMISSIONS = [
  { name: 'products:read', description: 'Produkte anzeigen', category: 'Produkte' },
  { name: 'products:write', description: 'Produkte bearbeiten', category: 'Produkte' },
  { name: 'products:approve', description: 'Produkte genehmigen/ablehnen', category: 'Produkte' },
  { name: 'products:sync', description: 'Produkte zu Shopware synchronisieren', category: 'Produkte' },
  { name: 'pricing:read', description: 'Preisregeln anzeigen', category: 'Preise' },
  { name: 'pricing:write', description: 'Preisregeln erstellen/bearbeiten', category: 'Preise' },
  { name: 'pricing:apply', description: 'Preisregeln anwenden', category: 'Preise' },
  { name: 'import:read', description: 'Import-Status anzeigen', category: 'Import' },
  { name: 'import:write', description: 'XML-Import durchführen', category: 'Import' },
  { name: 'admin:read', description: 'Benutzerrollen anzeigen', category: 'Administration' },
  { name: 'admin:write', description: 'Benutzerrollen verwalten', category: 'Administration' },
  { name: 'shipping:read', description: 'Versandkosten anzeigen', category: 'Versand' },
  { name: 'shipping:write', description: 'Versandkosten bearbeiten', category: 'Versand' },
];

const BOOTSTRAP_ADMIN_USERNAME = 'puchadev';

export async function bootstrapAdmin(): Promise<void> {
  const stackRoot = path.resolve(__dirname, '../../../stack-root');
  const passwordFilePath = path.join(stackRoot, 'pucha.dev');

  // Step 1: Ensure default permissions exist
  const existingPerms = await db.select().from(permissions);
  const existingPermNames = new Set(existingPerms.map(p => p.name));

  for (const perm of DEFAULT_PERMISSIONS) {
    if (!existingPermNames.has(perm.name)) {
      await db.insert(permissions).values({
        id: uuidv4(),
        name: perm.name,
        description: perm.description,
        category: perm.category,
      });
      console.log(`  ✓ Permission "${perm.name}" created`);
    }
  }

  // Step 2: Ensure admin role exists with all permissions
  let adminRole = await db.select().from(roles).where(eq(roles.name, 'admin')).limit(1);

  if (!adminRole.length) {
    const roleId = uuidv4();
    await db.insert(roles).values({
      id: roleId,
      name: 'admin',
      description: 'Vollständiger Administrator',
      isSystem: true,
    });

    const allPerms = await db.select().from(permissions);
    for (const perm of allPerms) {
      await db.insert(rolePermissions).values({
        id: uuidv4(),
        roleId,
        permissionId: perm.id,
      });
    }
    console.log('  ✓ Admin role created with all permissions');
    adminRole = await db.select().from(roles).where(eq(roles.name, 'admin')).limit(1);
  }

  // Step 3: Ensure default viewer role
  const viewerRole = await db.select().from(roles).where(eq(roles.name, 'viewer')).limit(1);
  if (!viewerRole.length) {
    const roleId = uuidv4();
    await db.insert(roles).values({
      id: roleId,
      name: 'viewer',
      description: 'Nur Lesen',
      isSystem: false,
    });

    const readPerms = await db.select().from(permissions)
      .where(eq(permissions.category, 'Produkte'));
    for (const perm of readPerms) {
      await db.insert(rolePermissions).values({
        id: uuidv4(),
        roleId,
        permissionId: perm.id,
      });
    }
    console.log('  ✓ Viewer role created');
  }

  // Step 4: Create bootstrap admin if not exists
  const existingAdmin = await db.select()
    .from(users)
    .where(eq(users.username, BOOTSTRAP_ADMIN_USERNAME))
    .limit(1);

  if (!existingAdmin.length) {
    let adminPassword: string;

    if (fs.existsSync(passwordFilePath)) {
      adminPassword = fs.readFileSync(passwordFilePath, 'utf-8').trim();
      console.log('  ✓ Bootstrap admin password loaded from file');
    } else {
      adminPassword = generateSecurePassword(32);

      if (!fs.existsSync(stackRoot)) {
        fs.mkdirSync(stackRoot, { recursive: true });
      }
      fs.writeFileSync(passwordFilePath, adminPassword, { mode: 0o600 });
      console.log('  ✓ Bootstrap admin password generated and saved to stack-root/pucha.dev');
    }

    const passwordHash = await hashPassword(adminPassword);
    const userId = uuidv4();

    await db.insert(users).values({
      id: userId,
      username: BOOTSTRAP_ADMIN_USERNAME,
      email: 'admin@matterhorn-wholesale.com',
      passwordHash,
      fullName: 'Bootstrap Admin',
      isActive: true,
      isBootstrapAdmin: true,
    });

    if (adminRole.length) {
      await db.insert(userRoles).values({
        id: uuidv4(),
        userId,
        roleId: adminRole[0].id,
        assignedBy: userId,
      });
    }

    console.log(`  ✓ Bootstrap admin "${BOOTSTRAP_ADMIN_USERNAME}" created`);
  } else {
    console.log(`  ✓ Bootstrap admin "${BOOTSTRAP_ADMIN_USERNAME}" already exists`);
  }
}
