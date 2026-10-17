import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { todayIso } from '../../lib/format.js';
import { back, done, renderError } from '../../lib/http.js';
import { randomId } from '../../lib/ids.js';
import { firstError, formValues } from '../../lib/validation.js';
import { courseExists, listCourses } from '../courses/queries.js';
import { deleteAnnouncement, getAnnouncement, insertAnnouncement } from './queries.js';
import { AnnouncementSchema } from './schema.js';

const notFound = (res: Parameters<typeof renderError>[0]) =>
  renderError(res, 404, 'Announcement not found', 'It may already have been deleted.');

/** Admin: /admin/announcements. */
export function announcementsAdminRouter({ db }: AppDeps): Router {
  const router = Router();

  router.get('/announcements/new', (req, res) => {
    const course = typeof req.query.course === 'string' ? req.query.course : '';
    res.render('admin/announcement-form.njk', {
      pageTitle: 'New announcement',
      formPage: true,
      courseOptions: [['', 'General'], ...listCourses(db).map((c) => [c.id, c.name])],
      v: res.locals.flash?.values ?? { course_id: course, posted_on: todayIso() },
    });
  });

  router.post('/announcements', (req, res) => {
    const parsed = AnnouncementSchema.safeParse(req.body);
    const fail = (msg: string) =>
      back(req, res, '/admin/announcements/new', msg, formValues(req.body));
    if (!parsed.success) return fail(firstError(parsed.error));
    const { body, course_id, posted_on } = parsed.data;
    if (course_id && !courseExists(db, course_id)) return fail('Choose a course from the list.');
    insertAnnouncement(db, randomId(), { body, course_id, posted_on: posted_on ?? todayIso() });
    done(req, res, '/admin', 'Announcement posted.');
  });

  router.get('/announcements/:id/delete', (req, res) => {
    const a = getAnnouncement(db, req.params.id);
    if (!a) return notFound(res);
    res.render('admin/confirm.njk', {
      pageTitle: 'Delete announcement',
      formPage: true,
      heading: 'Delete this announcement?',
      message: a.body,
      action: `/admin/announcements/${a.id}/delete`,
      cancel: '/admin',
      label: 'Delete',
    });
  });

  router.post('/announcements/:id/delete', (req, res) => {
    const id = req.params.id;
    if (!getAnnouncement(db, id)) return notFound(res);
    if (req.body?.confirmed !== '1') return res.redirect(303, `/admin/announcements/${id}/delete`);
    deleteAnnouncement(db, id);
    done(req, res, '/admin', 'Announcement deleted.');
  });

  return router;
}
