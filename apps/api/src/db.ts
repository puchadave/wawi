import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { strict as assert } from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const connectionString = process.env.DATABASE_URL;
assert(connectionString, 'DATABASE_URL environment variable is required');

const isProduction = process.env.NODE_ENV === 'production';

export const client = postgres(connectionString, { 
  max: 10,
  ssl: isProduction ? { rejectUnauthorized: true } : false,
  connection: {
    application_name: 'wawi-middleware',
  }
});
export const db = drizzle(client);
