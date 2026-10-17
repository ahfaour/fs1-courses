import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import nunjucks from 'nunjucks';
import { PUBLIC_DIR, VIEWS_DIR } from './config.js';
import type { AppDeps } from './deps.js';
import { formatDate, isHttpUrl, typeBadge } from './lib/format.js';
import { ah, renderError } from './lib/http.js';
import { announcementsAdminRouter } from './modules/announcements/routes.js';
import { csrfForForms, csrfToken } from './modules/auth/csrf.js';
import { requireAdmin } from './modules/auth/requireAdmin.js';
import { SESSION_COOKIE, loginRouter, logoutRouter } from './modules/auth/routes.js';
import { DbSessionStore } from './modules/auth/sessionStore.js';
import { coursesAdminRouter, coursesPublicRouter } from './modules/courses/routes.js';
import { lastUpdated, listCourses } from './modules/courses/queries.js';
import { filesRouter } from './modules/files/routes.js';
import { materialsAdminRouter } from './modules/materials/routes.js';
import { profileAdminRouter } from './modules/profile/routes.js';
import { getProfile } from './modules/profile/queries.js';

const EIGHT_HOURS = 8 * 60 * 60 * 1000;
const INLINE_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif']);

interface MaterialLike {
  file_id: string | null;
  url: string | null;
  original_name: string | null;
  mime_type: string | null;
}

function configureViews(app: express.Express, dev: boolean) {
  const env = nunjucks.configure(VIEWS_DIR, { autoescape: true, express: app, noCache: dev });
  env.addFilter('date', formatDate);
  env.addFilter('badge', typeBadge);
  env.addFilter('href', (m: MaterialLike) =>
    m.file_id
      ? `/files/${m.file_id}/${encodeURIComponent(m.original_name ?? 'file')}`
      : isHttpUrl(m.url)
        ? m.url
        : '#',
  );
  // External links and PDFs/images open in a new tab; other files simply download.
  env.addFilter('newTab', (m: MaterialLike) => !m.file_id || INLINE_MIME.has(m.mime_type ?? ''));
  // Form <select>: stored values may be numbers, submitted ones strings, missing ones undefined.
  env.addGlobal('sameValue', (a: unknown, b: unknown) => String(a ?? '') === String(b ?? ''));
  app.set('view engine', 'njk');
}

export function createApp(deps: AppDeps): express.Express {
  const { config, db } = deps;
  const app = express();
  app.disable('x-powered-by');
  // Render: Cloudflare → Render edge → app, so TRUST_PROXY=3 makes req.ip the visitor's address.
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  configureViews(app, config.env !== 'production');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", 'https://fonts.googleapis.com'],
          fontSrc: ['https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          scriptSrc: ["'self'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          objectSrc: ["'none'"],
        },
      },
    }),
  );

  app.get(
    '/healthz',
    ah(async (_req, res) => {
      await db.query('SELECT 1');
      res.type('text/plain').send('ok');
    }),
  );

  app.use(
    express.static(PUBLIC_DIR, { index: false, maxAge: config.env === 'production' ? '1d' : 0 }),
  );

  app.use(
    session({
      name: SESSION_COOKIE,
      secret: config.sessionSecret,
      store: new DbSessionStore(db),
      resave: false,
      saveUninitialized: false,
      rolling: true, // idle timeout: every request pushes expiry 8 h out
      proxy: config.trustProxy > 0,
      cookie: {
        httpOnly: true,
        secure: config.env === 'production',
        sameSite: 'lax',
        maxAge: EIGHT_HOURS,
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));

  app.use('/files', filesRouter(deps));

  // Page chrome every template needs: profile, course index, admin state, one-time flash.
  const chrome: RequestHandler = ah(async (req, res, next) => {
    const isAdmin = !!req.session.adminId;
    res.locals.isAdmin = isAdmin;
    if (isAdmin) {
      res.locals.adminEmail = req.session.adminEmail;
      res.locals.csrfToken = csrfToken(req);
      res.set('Cache-Control', 'no-store');
    }
    if (req.session.flash) {
      res.locals.flash = req.session.flash;
      delete req.session.flash;
    }
    const [courses, profile, updated] = await Promise.all([
      listCourses(db),
      getProfile(db),
      lastUpdated(db),
    ]);
    res.locals.navCourses = courses.filter((c) => c.kind === 'course');
    res.locals.navPrograms = courses.filter((c) => c.kind === 'program');
    res.locals.courseTotal = courses.length;
    res.locals.profile = profile;
    res.locals.lastUpdated = updated;
    next();
  });
  app.use(chrome);

  app.use(coursesPublicRouter(deps));
  app.use('/admin', loginRouter(deps));

  const admin = express.Router();
  admin.use(requireAdmin, csrfForForms);
  admin.use(logoutRouter());
  admin.use(coursesAdminRouter(deps));
  admin.use(materialsAdminRouter(deps));
  admin.use(announcementsAdminRouter(deps));
  admin.use(profileAdminRouter(deps));
  app.use('/admin', admin);

  app.use((_req, res) =>
    renderError(res, 404, 'Page not found', 'Nothing lives at this address. Try the course index.'),
  );

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (res.headersSent) return;
    const e = err as { type?: string; status?: number };
    if (e.type === 'entity.too.large') {
      return renderError(
        res,
        413,
        'Too large',
        'That form is too large. Shorten it and try again.',
      );
    }
    console.error(err);
    renderError(res, 500, 'Something went wrong', 'Try again in a moment.');
  };
  app.use(onError);

  return app;
}
