import { createApp } from './app.js';
import { loadConfig, loadDotEnv } from './config.js';
import { openDb } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { diskStorage } from './modules/files/storage.js';

loadDotEnv();
const config = loadConfig();
const db = openDb(config.databasePath);
const applied = migrate(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);

const app = createApp({ config, db, storage: diskStorage(config.uploadDir) });
const server = app.listen(config.port, () => {
  console.log(`FS1 Courses listening on http://localhost:${config.port} (${config.env})`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
