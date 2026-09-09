import { db } from '../db.js';
import { users, roles, permissions, userRoles, rolePermissions } from '../schema.js';
import { eq } from 'drizzle-orm';
import { hashPassword, generateSecurePassword, validatePasswordStrength } from './password.js';
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
  { name: 'ai:read', description: 'KI-Konfiguration anzeigen', category: 'KI' },
  { name: 'ai:write', description: 'KI-Konfiguration verwalten und Pipeline starten', category: 'KI' },
  { name: 'integrations:read', description: 'Integrationen anzeigen', category: 'Integrationen' },
  { name: 'integrations:write', description: 'Integrationen verwalten und testen', category: 'Integrationen' },
  { name: 'shopware:read', description: 'Shopware Verbindungen und Mappings anzeigen', category: 'Shopware' },
  { name: 'shopware:write', description: 'Shopware Synchronisation steuern', category: 'Shopware' },
];

const BOOTSTRAP_ADMIN_USERNAME = 'puchadev';
const BOOTSTRAP_ADMIN_EMAIL = 'admin@matterhorn-wholesale.com';

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

  // Step 4: Create bootstrap admin if not exists — installer-driven credentials take precedence
  const envUsername = (process.env.WAWI_ADMIN_USERNAME || process.env.ADMIN_USER || '').trim();
  const envEmail = (process.env.WAWI_ADMIN_EMAIL || '').trim();
  const envPassword = (process.env.WAWI_ADMIN_PASSWORD || '').trim();
  const envPasswordHash = (process.env.WAWI_ADMIN_PASSWORD_HASH || '').trim();

  const bootstrapUsername = envUsername || BOOTSTRAP_ADMIN_USERNAME;
  const bootstrapEmail = envEmail || BOOTSTRAP_ADMIN_EMAIL;

  const existingAdmin = await db.select()
    .from(users)
    .where(eq(users.username, bootstrapUsername))
    .limit(1);

  if (!existingAdmin.length) {
    let passwordHash: string;
    let passwordSource: string;

    if (envPasswordHash) {
      // Pre-hashed (Argon2id) provided by installer — never store plaintext
      passwordHash = envPasswordHash;
      passwordSource = 'WAWI_ADMIN_PASSWORD_HASH (installer, Argon2id)';
    } else if (envPassword) {
      const strength = validatePasswordStrength(envPassword);
      if (!strength.valid) {
        console.warn(`  ! WAWI_ADMIN_PASSWORD does not meet strength requirements: ${strength.errors.join('; ')} — continuing with provided password`);
      }
      passwordHash = await hashPassword(envPassword);
      passwordSource = 'WAWI_ADMIN_PASSWORD (installer, hashed with Argon2id)';
    } else if (fs.existsSync(passwordFilePath)) {
      const adminPassword = fs.readFileSync(passwordFilePath, 'utf-8').trim();
      if (!adminPassword) {
        throw new Error(`Password file ${passwordFilePath} is empty`);
      }
      passwordHash = await hashPassword(adminPassword);
      passwordSource = `stack-root/pucha.dev`;
      console.log('  ✓ Bootstrap admin password loaded from file');
    } else {
      const adminPassword = generateSecurePassword(32);
      if (!fs.existsSync(stackRoot)) {
        fs.mkdirSync(stackRoot, { recursive: true });
      }
      fs.writeFileSync(passwordFilePath, adminPassword, { mode: 0o600 });
      console.log('  ✓ Bootstrap admin password generated and saved to stack-root/pucha.dev');
      passwordHash = await hashPassword(adminPassword);
      passwordSource = 'generated (stack-root/pucha.dev)';
    }

    const userId = uuidv4();

    await db.insert(users).values({
      id: userId,
      username: bootstrapUsername,
      email: bootstrapEmail,
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

    console.log(`  ✓ Bootstrap admin "${bootstrapUsername}" <${bootstrapEmail}> created via ${passwordSource}`);
  } else {
    console.log(`  ✓ Bootstrap admin "${bootstrapUsername}" already exists`);
  }
}
