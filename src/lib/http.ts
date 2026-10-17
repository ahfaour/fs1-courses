import type { NextFunction, Request, Response } from 'express';
import type { Flash } from '../types.js';

export function setFlash(req: Request, flash: Flash): void {
  req.session.flash = flash;
}

/** Success: flash a message and redirect (Post/Redirect/Get). */
export function done(req: Request, res: Response, to: string, message: string): void {
  setFlash(req, { type: 'ok', message });
  res.redirect(303, to);
}

/** Validation error: flash it with the submitted values and send the admin back to the form. */
export function back(
  req: Request,
  res: Response,
  to: string,
  message: string,
  values?: Record<string, string>,
): void {
  setFlash(req, { type: 'error', message, values });
  res.redirect(303, to);
}

/** A same-site path from a Referer header, or undefined. Never an absolute or protocol-relative URL. */
export function localPathFrom(referer: string | undefined, req: Request): string | undefined {
  if (!referer) return undefined;
  try {
    const u = new URL(referer);
    if (u.host !== req.get('host')) return undefined;
    return safeReturnPath(u.pathname + u.search);
  } catch {
    return undefined;
  }
}

export function safeReturnPath(p: string | undefined): string | undefined {
  if (!p || !p.startsWith('/') || p.startsWith('//') || p.includes('\\')) return undefined;
  if (p.startsWith('/admin/login') || p.startsWith('/admin/logout')) return undefined;
  return p;
}

/** Error page in the site layout; plain text if the layout itself cannot render. */
export function renderError(res: Response, status: number, heading: string, message: string): void {
  res
    .status(status)
    .render('error.njk', { status, heading, message, pageTitle: heading }, (err, html) => {
      if (err) {
        console.error('Error page failed to render:', err);
        res.type('text/plain').send(`${heading}. ${message}`);
      } else res.send(html);
    });
}

/** Express 4 does not catch rejected promises: forward them to the error handler. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
