import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import type { S3Config } from '../../config.js';
import { FILE_ID_RE } from '../../lib/ids.js';
import type { FileStorage } from './storage.js';

/**
 * Uploads in an S3-compatible bucket (Cloudflare R2, Backblaze B2, AWS S3…), for hosts whose
 * disk is wiped on restart. Objects are private; the app streams them through /files/:id.
 */
export function s3Storage(cfg: S3Config): FileStorage {
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint ?? undefined,
    forcePathStyle: !!cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  const tempDir = path.join(os.tmpdir(), 'fs1-uploads');
  fs.mkdirSync(tempDir, { recursive: true });

  const keyFor = (id: string) => {
    if (!FILE_ID_RE.test(id)) throw new Error('Invalid file id');
    return `${cfg.prefix}${id}`;
  };

  return {
    tempDir,

    async put(tempPath, id) {
      const { size } = await fsp.stat(tempPath);
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: keyFor(id),
          Body: fs.createReadStream(tempPath),
          ContentLength: size,
        }),
      );
      await fsp.rm(tempPath, { force: true });
    },

    async remove(id) {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: keyFor(id) }));
    },

    async open(id) {
      try {
        const r = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: keyFor(id) }));
        if (!(r.Body instanceof Readable)) return null;
        return { stream: r.Body, size: r.ContentLength ?? 0 };
      } catch (err) {
        if (err instanceof NoSuchKey) return null;
        if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) return null;
        throw err;
      }
    },

    async list() {
      const out: { id: string; mtimeMs: number }[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: cfg.bucket,
            Prefix: cfg.prefix,
            ContinuationToken: token,
          }),
        );
        for (const o of page.Contents ?? []) {
          const id = o.Key?.slice(cfg.prefix.length) ?? '';
          if (FILE_ID_RE.test(id)) out.push({ id, mtimeMs: o.LastModified?.getTime() ?? 0 });
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
  };
}
