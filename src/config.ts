import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Project root: the nearest folder above this file that holds package.json (works from src/ and dist/). */
function findRoot(start: string): string {
  let dir = start;
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
  return dir;
}

export const ROOT = findRoot(path.dirname(fileURLToPath(import.meta.url)));
export const VIEWS_DIR = path.join(ROOT, 'src', 'views');
export const MIGRATIONS_DIR = path.join(ROOT, 'src', 'db', 'migrations');
export const PUBLIC_DIR = path.join(ROOT, 'public');

/** 'false'/'' → 0, 'true' → 1, a number → that many proxy hops. */
const proxyHops = z
  .string()
  .optional()
  .transform((v, ctx) => {
    const s = (v ?? '').trim().toLowerCase();
    if (['', '0', 'false', 'no'].includes(s)) return 0;
    if (['true', 'yes'].includes(s)) return 1;
    const n = Number(s);
    if (Number.isInteger(n) && n > 0 && n < 10) return n;
    ctx.addIssue({ code: 'custom', message: 'must be false, true or a number of proxy hops' });
    return z.NEVER;
  });

const optional = z
  .string()
  .optional()
  .transform((v) => v?.trim() || null);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: optional,
  PGLITE_DIR: z.string().min(1).default('./data/pglite'),
  UPLOAD_DIR: z.string().min(1).default('./data/uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(2048).default(50),
  SESSION_SECRET: z.string().optional(),
  TRUST_PROXY: proxyHops,
  S3_BUCKET: optional,
  S3_ENDPOINT: optional,
  S3_REGION: optional,
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,
  S3_PREFIX: z.string().default('uploads/'),
  RENDER: optional,
});

export interface S3Config {
  bucket: string;
  endpoint: string | null;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
}

export interface Config {
  env: 'development' | 'production' | 'test';
  port: number;
  /** Postgres (e.g. Neon). null → embedded PGlite at `pgliteDir` ('memory' for tests). */
  databaseUrl: string | null;
  pgliteDir: string;
  /** Where uploads live when `s3` is null. */
  uploadDir: string;
  s3: S3Config | null;
  maxUploadMb: number;
  sessionSecret: string;
  /** Number of reverse-proxy hops in front of the app (0 = none). */
  trustProxy: number;
}

/** Loads `.env` (if present) into process.env without overriding variables that are already set. */
export function loadDotEnv(file = path.join(ROOT, '.env')): void {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid configuration: ${issue?.path.join('.')} ${issue?.message}`);
  }
  const e = parsed.data;
  let secret = e.SESSION_SECRET ?? '';
  if (secret.length < 32) {
    if (e.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET must be set to at least 32 characters in production.');
    }
    secret = secret || 'dev-only-session-secret-not-for-production-use';
  }
  let s3: S3Config | null = null;
  if (e.S3_BUCKET) {
    if (!e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY) {
      throw new Error(
        'S3_BUCKET is set, so S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required.',
      );
    }
    s3 = {
      bucket: e.S3_BUCKET,
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION ?? 'auto',
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      prefix: e.S3_PREFIX,
    };
  }
  // Render's free plan wipes the local disk on every restart: refuse to lose data silently.
  // With DATABASE_URL, uploads go to the database too (unless a bucket is configured).
  if (e.RENDER && !e.DATABASE_URL) {
    throw new Error('On Render, set DATABASE_URL (Postgres); the local disk is not kept.');
  }
  const resolve = (p: string) => (p === 'memory' ? p : path.resolve(ROOT, p));
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    pgliteDir: resolve(e.PGLITE_DIR),
    uploadDir: resolve(e.UPLOAD_DIR),
    s3,
    maxUploadMb: e.MAX_UPLOAD_MB,
    sessionSecret: secret,
    trustProxy: e.TRUST_PROXY,
  };
}
