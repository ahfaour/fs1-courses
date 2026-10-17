import type { Config } from '../../config.js';
import type { DB } from '../../db/connection.js';
import { dbStorage } from './dbStorage.js';
import { s3Storage } from './s3Storage.js';
import { diskStorage, type FileStorage } from './storage.js';

/** A bucket when S3_BUCKET is set, else the database when it is Postgres (DATABASE_URL), else disk. */
export function pickStorage(config: Config, db: DB): { storage: FileStorage; where: string } {
  if (config.s3) return { storage: s3Storage(config.s3), where: `bucket ${config.s3.bucket}` };
  if (config.databaseUrl) return { storage: dbStorage(db), where: 'the database' };
  return { storage: diskStorage(config.uploadDir), where: config.uploadDir };
}
