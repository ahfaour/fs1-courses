import { loadConfig, loadDotEnv } from '../src/config.js';
import { openDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';

loadDotEnv();
const db = openDb(loadConfig().databasePath);
migrate(db);
const r = seed(db);
console.log(
  `Seed done: ${r.courses} course(s) added${r.profile ? ', profile created' : ''}. Existing rows were left alone.`,
);
db.close();
