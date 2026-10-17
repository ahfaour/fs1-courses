/**
 * Creates the admin account, or resets its password if the email exists.
 *   npm run create-admin -- --email you@example.com
 * The password is always typed at the prompt; it is never read from arguments or env vars.
 */
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { loadConfig, loadDotEnv } from '../src/config.js';
import { openDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { MIN_PASSWORD_LENGTH, hashPassword } from '../src/modules/auth/passwords.js';
import { upsertAdmin } from '../src/modules/auth/queries.js';

const { values } = parseArgs({ options: { email: { type: 'string' } } });
const email = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .safeParse(values.email ?? '');
if (!email.success) {
  console.error('Usage: npm run create-admin -- --email you@example.com');
  process.exit(1);
}

// stdout that can be muted so the typed password is not echoed.
let muted = false;
const out = new Writable({
  write(chunk, encoding, cb) {
    if (!muted) process.stdout.write(chunk, encoding);
    cb();
  },
});
const rl = readline.createInterface({
  input: process.stdin,
  output: out,
  terminal: process.stdin.isTTY,
});
const lines = rl[Symbol.asyncIterator]();

async function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  muted = true;
  const { value, done } = await lines.next();
  muted = false;
  process.stdout.write('\n');
  if (done) throw new Error('No input.');
  return String(value);
}

try {
  if (!process.stdin.isTTY) {
    console.warn('Warning: input is not a terminal, so the password may be visible.');
  }
  const password = await ask(
    `Password for ${email.data} (at least ${MIN_PASSWORD_LENGTH} characters): `,
  );
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if ((await ask('Repeat the password: ')) !== password)
    throw new Error('The passwords do not match.');

  loadDotEnv();
  const db = openDb(loadConfig().databasePath);
  migrate(db);
  const result = upsertAdmin(db, email.data, await hashPassword(password));
  db.close();
  console.log(
    result === 'created' ? `Admin ${email.data} created.` : `Password for ${email.data} updated.`,
  );
  rl.close();
} catch (err) {
  rl.close();
  console.error((err as Error).message);
  process.exit(1);
}
