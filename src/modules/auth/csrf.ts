import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { renderError } from '../../lib/http.js';

/** The session's synchronizer token, created on first use. */
export function csrfToken(req: Request): string {
  req.session.csrf ??= crypto.randomBytes(32).toString('base64url');
  return req.session.csrf;
}

function matches(sent: unknown, expected: string | undefined): boolean {
  if (typeof sent !== 'string' || !expected) return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Rejects a state-changing request whose `_csrf` field does not match the session token. */
export function verifyCsrf(req: Request, res: Response, next: NextFunction): void {
  const body = req.body as Record<string, unknown> | undefined;
  if (matches(body?._csrf, req.session.csrf)) return next();
  renderError(
    res,
    403,
    'This form has expired',
    'The page was open for too long or the form is not from this site. Go back, reload the page and try again.',
  );
}

const isMultipart = (req: Request) => (req.headers['content-type'] ?? '').startsWith('multipart/');

/**
 * CSRF for every POST on the admin router. Multipart bodies are not parsed yet at this point,
 * so routes that accept uploads run `verifyCsrf` themselves right after the upload middleware.
 */
export function csrfForForms(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'POST' || isMultipart(req)) return next();
  verifyCsrf(req, res, next);
}
