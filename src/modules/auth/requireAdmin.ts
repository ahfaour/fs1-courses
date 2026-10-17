import type { NextFunction, Request, Response } from 'express';
import { localPathFrom, safeReturnPath } from '../../lib/http.js';

/**
 * The only auth check: mounted on the /admin router. Signed-out requests go to the login page,
 * which sends the admin back to the page they were on afterwards.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.session.adminId) return next();
  const returnTo =
    req.method === 'GET' ? safeReturnPath(req.originalUrl) : localPathFrom(req.get('referer'), req);
  if (returnTo) req.session.returnTo = returnTo;
  res.redirect(303, '/admin/login');
}
