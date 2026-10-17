import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { safeReturnPath } from '../../lib/http.js';
import { csrfToken, verifyCsrf } from './csrf.js';
import { verifyPassword } from './passwords.js';
import { findAdminByEmail } from './queries.js';

export const SESSION_COOKIE = 'fs1.sid';
const GENERIC_ERROR = 'Email or password is incorrect.';

const LoginSchema = z.object({
  email: z.string().trim().max(200).default(''),
  password: z.string().max(1000).default(''),
});

function renderLogin(req: Request, res: Response, status = 200, error = '', email = '') {
  res.status(status).render('admin/login.njk', {
    pageTitle: 'Sign in',
    formPage: true,
    error,
    email,
    csrfToken: csrfToken(req),
  });
}

/** /admin/login (GET/POST). Mounted before the requireAdmin router. */
export function loginRouter({ db }: AppDeps): Router {
  const router = Router();

  // At most 5 failed attempts per IP per 15 minutes; successful sign-ins are not counted.
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).render('error.njk', {
        status: 429,
        heading: 'Too many sign-in attempts',
        message: 'Wait 15 minutes, then try again.',
        pageTitle: 'Too many attempts',
      });
    },
  });

  router.get('/login', (req, res) => {
    if (req.session.adminId) return res.redirect(303, '/admin');
    renderLogin(req, res);
  });

  router.post('/login', limiter, verifyCsrf, async (req, res, next) => {
    try {
      const { email, password } = LoginSchema.parse(req.body ?? {});
      const admin = email ? findAdminByEmail(db, email) : undefined;
      const ok = await verifyPassword(admin?.password_hash, password);
      if (!admin || !ok) return renderLogin(req, res, 401, GENERIC_ERROR, email);

      const returnTo = safeReturnPath(req.session.returnTo) ?? '/admin';
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.adminId = admin.id;
        req.session.adminEmail = admin.email;
        csrfToken(req);
        req.session.save((err2) => (err2 ? next(err2) : res.redirect(303, returnTo)));
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** POST /admin/logout. Mounted on the admin router (session + CSRF required). */
export function logoutRouter(): Router {
  const router = Router();
  router.post('/logout', (req, res, next) => {
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      res.redirect(303, '/');
    });
  });
  return router;
}
