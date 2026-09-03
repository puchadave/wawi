import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import { strict as assert } from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const JWT_SECRET = process.env.JWT_SECRET!;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');
if (JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
if (JWT_SECRET.includes('change')) throw new Error('JWT_SECRET must not contain placeholder text');
if (JWT_SECRET.includes('dev')) throw new Error('JWT_SECRET must not contain "dev"');

const JWT_ISSUER = 'wawi-middleware';
const JWT_AUDIENCE = 'wawi-web';
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

export interface JWTPayload {
  sub: string;
  username: string;
  roles: string[];
  permissions: string[];
  csrfToken: string;
}

export function generateAccessToken(payload: Omit<JWTPayload, 'csrfToken'>, csrfToken: string): string {
  return jwt.sign(
    { ...payload, csrfToken },
    JWT_SECRET,
    {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: ACCESS_TOKEN_TTL,
    }
  );
}

export function generateRefreshToken(userId: string): string {
  return jwt.sign(
    { sub: userId, type: 'refresh' },
    JWT_SECRET,
    {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: REFRESH_TOKEN_TTL,
    }
  );
}

export function verifyAccessToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET!, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as JWTPayload;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): { sub: string; type: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET!, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as { sub: string; type: string };
    if (decoded.type !== 'refresh') return null;
    return decoded;
  } catch {
    return null;
  }
}

export function generateCSRFToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
