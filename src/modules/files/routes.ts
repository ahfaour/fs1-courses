import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { renderError } from '../../lib/http.js';
import { FILE_ID_RE } from '../../lib/ids.js';
import { getFile } from './queries.js';

const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif']);
const SCRIPTABLE = /html|svg|xml|javascript|ecmascript/i;

/** Content-Disposition with an ASCII fallback and an RFC 5987 `filename*` for Arabic/French names. */
export function contentDisposition(type: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** GET /files/:id/:filename? — the filename part is cosmetic; only the id is looked up. */
export function filesRouter({ db, storage }: AppDeps): Router {
  const router = Router();

  router.get('/:id/:filename?', async (req, res, next) => {
    const notFound = () =>
      renderError(res, 404, 'File not found', 'This file has been removed or the link is wrong.');
    try {
      const { id } = req.params;
      if (!id || !FILE_ID_RE.test(id)) return notFound();
      const row = getFile(db, id);
      if (!row) return notFound();

      const etag = `"${row.sha256}"`;
      if (req.get('if-none-match') === etag) return res.status(304).end();

      const opened = await storage.open(row.id);
      if (!opened) {
        console.warn(`File ${row.id} is in the database but missing from storage.`);
        return notFound();
      }

      const type = SCRIPTABLE.test(row.mime_type) ? 'application/octet-stream' : row.mime_type;
      res.set({
        'Content-Type': type,
        'Content-Length': String(opened.size),
        'Content-Disposition': contentDisposition(
          INLINE_TYPES.has(type) ? 'inline' : 'attachment',
          row.original_name,
        ),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=86400',
        ETag: etag,
      });
      if (req.method === 'HEAD') {
        opened.stream.destroy();
        return res.end();
      }
      await pipeline(opened.stream, res);
    } catch (err) {
      if (res.headersSent) return res.destroy(err as Error);
      next(err);
    }
  });

  return router;
}
