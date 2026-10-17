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

const boolish = z
  .string()
  .optional()
  .transform((v) => ['1', 'true', 'yes'].includes((v ?? '').trim().toLowerCase()));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1).default('./data/site.db'),
  UPLOAD_DIR: z.string().min(1).default('./data/uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(2048).default(50),
  SESSION_SECRET: z.string().optional(),
  TRUST_PROXY: boolish,
});

export interface Config {
  env: 'development' | 'production' | 'test';
  port: number;
  databasePath: string;
  uploadDir: string;
  maxUploadMb: number;
  sessionSecret: string;
  trustProxy: boolean;
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
  const resolve = (p: string) => (p === ':memory:' ? p : path.resolve(ROOT, p));
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    databasePath: resolve(e.DATABASE_PATH),
    uploadDir: resolve(e.UPLOAD_DIR),
    maxUploadMb: e.MAX_UPLOAD_MB,
    sessionSecret: secret,
    trustProxy: e.TRUST_PROXY,
  };
}
