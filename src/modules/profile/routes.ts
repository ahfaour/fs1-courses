import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { back, done } from '../../lib/http.js';
import { firstError, formValues } from '../../lib/validation.js';
import { getProfile, saveProfile } from './queries.js';
import { ProfileSchema } from './schema.js';

/** Admin: /admin/profile. */
export function profileAdminRouter({ db }: AppDeps): Router {
  const router = Router();

  router.get('/profile', (req, res) => {
    res.render('admin/profile-form.njk', {
      pageTitle: 'Name & contact',
      formPage: true,
      v: res.locals.flash?.values ?? getProfile(db),
    });
  });

  router.post('/profile', (req, res) => {
    const parsed = ProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return back(req, res, '/admin/profile', firstError(parsed.error), formValues(req.body));
    }
    saveProfile(db, parsed.data);
    done(req, res, '/admin', 'Profile saved.');
  });

  return router;
}
