import { createApp } from './app.js';
import { loadConfig, loadDotEnv } from './config.js';
import { openDb } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { hasProfile } from './modules/profile/queries.js';
import { pickStorage } from './modules/files/pickStorage.js';

loadDotEnv();
const config = loadConfig();
const db = await openDb(config);
const applied = await migrate(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
// First start on an empty database: add the starter profile and courses. Never again after that,
// so courses the instructor deleted do not come back.
if (!(await hasProfile(db))) {
  const r = await seed(db);
  console.log(`Seeded ${r.courses} course(s).`);
}

const { storage, where: files } = pickStorage(config, db);
const app = createApp({ config, db, storage });
const server = app.listen(config.port, () => {
  const where = config.databaseUrl ? 'Postgres' : `PGlite at ${config.pgliteDir}`;
  console.log(`FS1 Courses listening on http://localhost:${config.port} (${config.env})`);
  console.log(`Database: ${where}. Files: ${files}.`);
});

function shutdown() {
  server.close(() => {
    void db.close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
