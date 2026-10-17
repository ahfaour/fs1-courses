import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { fileTypeFromFile } from 'file-type';
import multer from 'multer';
import type { AppDeps } from '../../deps.js';
import { randomId } from '../../lib/ids.js';
import type { FileRow } from './queries.js';

/**
 * Allowed uploads by extension. `detect` lists what `file-type` must report from the file's first
 * bytes; null means a text format, which must not look like any known binary type.
 */
export const ALLOWED_TYPES: Record<string, { mime: string; detect: readonly string[] | null }> = {
  pdf: { mime: 'application/pdf', detect: ['pdf'] },
  pptx: {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    detect: ['pptx', 'zip'],
  },
  ppt: { mime: 'application/vnd.ms-powerpoint', detect: ['cfb'] },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    detect: ['docx', 'zip'],
  },
  doc: { mime: 'application/msword', detect: ['cfb'] },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    detect: ['xlsx', 'zip'],
  },
  xls: { mime: 'application/vnd.ms-excel', detect: ['cfb'] },
  zip: { mime: 'application/zip', detect: ['zip'] },
  png: { mime: 'image/png', detect: ['png'] },
  jpg: { mime: 'image/jpeg', detect: ['jpg'] },
  jpeg: { mime: 'image/jpeg', detect: ['jpg'] },
  gif: { mime: 'image/gif', detect: ['gif'] },
  csv: { mime: 'text/csv', detect: null },
  txt: { mime: 'text/plain', detect: null },
  md: { mime: 'text/markdown', detect: null },
  ipynb: { mime: 'application/x-ipynb+json', detect: null },
  sql: { mime: 'application/sql', detect: null },
  py: { mime: 'text/x-python', detect: null },
  java: { mime: 'text/x-java', detect: null },
  c: { mime: 'text/x-c', detect: null },
  cpp: { mime: 'text/x-c++', detect: null },
  h: { mime: 'text/x-c', detect: null },
};

export const TYPE_MESSAGE =
  "This file type can't be uploaded. Use PDF, Office, notebook, code, image or zip files, or share a link instead.";

export const sizeMessage = (mb: number) =>
  `That file is over the ${mb} MB limit. Share it through a link instead.`;

export class UploadRejected extends Error {}

export const extensionOf = (name: string): string =>
  /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase() ?? '';

export const isAllowedName = (name: string): boolean =>
  Object.hasOwn(ALLOWED_TYPES, extensionOf(name));

/** Keeps the original name for display and download, minus path parts and control characters. */
export function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const printable = [...base].filter((ch) => ch >= ' ' && ch !== '\u007f').join('');
  return printable.trim().slice(0, 200) || 'file';
}

/**
 * multer for one optional `file` field, written to the storage temp dir under a random name.
 * Disallowed extensions are dropped before anything is written; oversize files are aborted and
 * removed by multer. Either way the handler sees `req.uploadRejected`. Any temp file left when
 * the response ends is deleted.
 */
export function uploadSingle({ config, storage }: AppDeps): RequestHandler {
  const upload = multer({
    storage: multer.diskStorage({
      destination: storage.tempDir,
      filename: (_req, _file, cb) => cb(null, randomId()),
    }),
    limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1, fields: 30 },
    defParamCharset: 'utf8',
    fileFilter: (req, file, cb) => {
      if (isAllowedName(file.originalname)) return cb(null, true);
      req.uploadRejected = 'type';
      cb(null, false);
    },
  }).single('file');

  return (req: Request, res: Response, next: NextFunction) => {
    res.on('close', () => {
      if (req.file?.path) fs.rm(req.file.path, { force: true }, () => {});
    });
    upload(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        req.uploadRejected = 'size';
        req.file = undefined;
        return next();
      }
      next(err);
    });
  };
}

async function sha256(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function looksBinary(file: string): Promise<boolean> {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    await fh.close();
  }
}

/**
 * Checks extension and detected type, hashes the file and moves it into storage.
 * Throws UploadRejected for a bad file (show the message), anything else for a storage failure.
 */
export async function storeUpload(
  { storage }: AppDeps,
  file: Express.Multer.File,
): Promise<Omit<FileRow, 'created_at'>> {
  const ext = extensionOf(file.originalname);
  const rule = ALLOWED_TYPES[ext];
  if (!rule) throw new UploadRejected(TYPE_MESSAGE);

  const detected = await fileTypeFromFile(file.path);
  const ok = rule.detect
    ? !!detected && rule.detect.includes(detected.ext)
    : !detected && !(await looksBinary(file.path));
  if (!ok) {
    throw new UploadRejected(
      `This file's contents don't match its .${ext} name. Check the file, or share a link instead.`,
    );
  }

  const row = {
    id: randomId(),
    original_name: cleanName(file.originalname),
    mime_type: rule.mime,
    size_bytes: file.size,
    sha256: await sha256(file.path),
  };
  await storage.put(file.path, row.id);
  return row;
}
