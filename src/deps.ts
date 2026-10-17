import type { Config } from './config.js';
import type { DB } from './db/connection.js';
import type { FileStorage } from './modules/files/storage.js';

/** What every router needs. Built once in server.ts (or per test) and passed down. */
export interface AppDeps {
  config: Config;
  db: DB;
  storage: FileStorage;
}
