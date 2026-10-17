import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { pglite, type DB } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { hashPassword } from '../src/modules/auth/passwords.js';
import { upsertAdmin } from '../src/modules/auth/queries.js';
import { diskStorage } from '../src/modules/files/storage.js';

export const ADMIN_EMAIL = 'admin@example.com';
// Test-only credential for the throwaway in-memory database.
export const ADMIN_PASSWORD = 'correct horse battery staple';

let hash: Promise<string> | undefined;
// Starting PGlite takes a couple of seconds, so each test file shares one in-memory database
// and empties it before every test.
let shared: Promise<DB> | undefined;

async function freshDb(): Promise<DB> {
  shared ??= pglite('memory').then(async (db) => {
    await migrate(db);
    return db;
  });
  const db = await shared;
  await db.exec(
    'TRUNCATE sessions, announcements, materials, files, courses, profile, admins RESTART IDENTITY CASCADE',
  );
  await seed(db);
  hash ??= hashPassword(ADMIN_PASSWORD);
  await upsertAdmin(db, ADMIN_EMAIL, await hash);
  return db;
}

/** A fresh app on an in-memory, seeded database with one admin, and a temp uploads folder. */
export async function makeApp(overrides: Partial<Config> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs1-test-'));
  const config: Config = {
    env: 'test',
    port: 0,
    databaseUrl: null,
    pgliteDir: 'memory',
    uploadDir: path.join(dir, 'uploads'),
    s3: null,
    maxUploadMb: 1,
    sessionSecret: 'test-secret-that-is-long-enough-1234567890',
    trustProxy: 0,
    ...overrides,
  };
  const db = await freshDb();
  const storage = diskStorage(config.uploadDir);
  const app = createApp({ config, db, storage });
  const cleanup = () => {
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { app, db, config, storage, dir, cleanup };
}

export const csrfFrom = (html: string): string => {
  const token = /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
  if (!token) throw new Error('No CSRF token on the page');
  return token;
};

/** Signs in and returns a cookie-keeping agent plus the session's CSRF token. */
export async function signIn(app: Parameters<typeof request.agent>[0]) {
  const agent = request.agent(app);
  const page = await agent.get('/admin/login').expect(200);
  await agent
    .post('/admin/login')
    .type('form')
    .send({ _csrf: csrfFrom(page.text), email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    .expect(303);
  const dash = await agent.get('/admin').expect(200);
  return { agent, csrf: csrfFrom(dash.text) };
}

export const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n',
);
