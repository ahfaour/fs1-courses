/**
 * Copies all site content (courses, materials, announcements, uploaded files, admins) from one
 * Postgres database to another, e.g. from Neon to Aiven. Sessions are not copied.
 *
 * The connection strings come from the environment, so passwords stay out of the command line:
 *   SOURCE_DATABASE_URL  the database to copy from (only read)
 *   TARGET_DATABASE_URL  the new, empty database to copy into
 *
 * Without --yes it only shows how many rows each table holds.
 *   npm run copy-db                 # dry run
 *   npm run copy-db -- --yes        # do it
 */
import { parseArgs } from 'node:util';
import { loadDotEnv } from '../src/config.js';
import { openDb } from '../src/db/connection.js';
import { copyDatabase, tableCounts } from '../src/db/copy.js';

const { values } = parseArgs({ options: { yes: { type: 'boolean', default: false } } });

loadDotEnv();
const sourceUrl = process.env.SOURCE_DATABASE_URL;
const targetUrl = process.env.TARGET_DATABASE_URL;
if (!sourceUrl || !targetUrl) {
  console.error('Set SOURCE_DATABASE_URL and TARGET_DATABASE_URL.');
  process.exit(1);
}
if (sourceUrl === targetUrl) {
  console.error('SOURCE_DATABASE_URL and TARGET_DATABASE_URL are the same database.');
  process.exit(1);
}

const source = await openDb({ databaseUrl: sourceUrl, pgliteDir: '' });
const target = await openDb({ databaseUrl: targetUrl, pgliteDir: '' });
try {
  console.log('Rows in the source database:');
  console.table(await tableCounts(source));
  if (!values.yes) {
    console.log('Dry run: nothing copied. Run again with --yes to copy.');
  } else {
    const copied = await copyDatabase(source, target);
    console.log('Copied. Rows now in the target database:');
    console.table(copied);
  }
} finally {
  await source.close();
  await target.close();
}
