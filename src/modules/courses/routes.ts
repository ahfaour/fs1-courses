import { Router, type Request, type Response } from 'express';
import type { AppDeps } from '../../deps.js';
import { ah, back, done, renderError } from '../../lib/http.js';
import { COURSE_ID_RE, slugify } from '../../lib/ids.js';
import { firstError, formValues } from '../../lib/validation.js';
import { listAnnouncements } from '../announcements/queries.js';
import { removeQuietly } from '../files/storage.js';
import { listForCourse, searchMaterials } from '../materials/queries.js';
import { SECTIONS, sectionsFor } from '../materials/sections.js';
import {
  courseExists,
  deleteCourse,
  getCourse,
  insertCourse,
  listCourses,
  nextSortOrder,
  countCourses,
  updateCourse,
} from './queries.js';
import { COLORS, CourseSchema } from './schema.js';

const courseNotFound = (res: Response) =>
  renderError(
    res,
    404,
    'Course not found',
    'There is no course at this address. Pick one from the index.',
  );

/** Overview: shared by `/` and the admin dashboard `/admin`. */
export async function renderOverview({ db }: AppDeps, _req: Request, res: Response): Promise<void> {
  const [courses, announcements] = await Promise.all([listCourses(db), listAnnouncements(db)]);
  res.render('home.njk', { currentPage: 'home', courses, announcements });
}

/** Public: overview, course page and search. */
export function coursesPublicRouter(deps: AppDeps): Router {
  const { db } = deps;
  const router = Router();

  router.get(
    '/',
    ah((req, res) => renderOverview(deps, req, res)),
  );

  router.get(
    '/courses/:id',
    ah(async (req, res) => {
      const id = req.params.id ?? '';
      const course = COURSE_ID_RE.test(id) ? await getCourse(db, id) : undefined;
      if (!course) return courseNotFound(res);
      const materials = await listForCourse(db, id, { includeHidden: !!req.session.adminId });
      const offered = new Set(sectionsFor(course.kind).map((s) => s.key));
      const groups = SECTIONS.map((s) => ({
        ...s,
        items: materials.filter((m) => m.section === s.key),
      })).filter((g) => offered.has(g.key) || g.items.length > 0);
      res.render('course.njk', {
        pageTitle: course.name,
        currentCourseId: course.id,
        course,
        groups,
        materialCount: materials.length,
      });
    }),
  );

  router.get(
    '/search',
    ah(async (req, res) => {
      const raw = typeof req.query.q === 'string' ? req.query.q : '';
      const q = raw.trim().slice(0, 100);
      res.render('search.njk', {
        pageTitle: q ? `Search: ${q}` : 'Search',
        currentPage: 'search',
        q,
        hits: q ? await searchMaterials(db, q, { includeHidden: !!req.session.adminId }) : [],
        partial: req.query.partial === '1',
      });
    }),
  );

  return router;
}

/** Admin: dashboard and course CRUD. */
export function coursesAdminRouter(deps: AppDeps): Router {
  const { db, storage } = deps;
  const router = Router();

  router.get(
    '/',
    ah((req, res) => renderOverview(deps, req, res)),
  );

  const renderForm = (res: Response, title: string, action: string, cancel: string, v: unknown) =>
    res.render('admin/course-form.njk', {
      pageTitle: title,
      formPage: true,
      title,
      action,
      cancel,
      v,
      colorOptions: COLORS.map((name, i) => [i, name]),
    });

  router.get(
    '/courses/new',
    ah(async (_req, res) => {
      renderForm(
        res,
        'Add a course',
        '/admin/courses',
        '/admin',
        res.locals.flash?.values ?? {
          kind: 'course',
          color_index: (await countCourses(db)) % COLORS.length,
          sort_order: await nextSortOrder(db),
        },
      );
    }),
  );

  router.post(
    '/courses',
    ah(async (req, res) => {
      const parsed = CourseSchema.safeParse(req.body);
      if (!parsed.success) {
        return back(req, res, '/admin/courses/new', firstError(parsed.error), formValues(req.body));
      }
      const taken = new Set((await listCourses(db)).map((c) => c.id));
      const id = slugify(parsed.data.name, (s) => taken.has(s));
      await insertCourse(db, id, parsed.data);
      done(req, res, `/courses/${id}`, 'Course added.');
    }),
  );

  router.get(
    '/courses/:id/edit',
    ah(async (req, res) => {
      const course = await getCourse(db, req.params.id ?? '');
      if (!course) return courseNotFound(res);
      renderForm(
        res,
        'Edit course',
        `/admin/courses/${course.id}`,
        `/courses/${course.id}`,
        res.locals.flash?.values ?? { ...course, topics: course.topics.join('\n') },
      );
    }),
  );

  router.post(
    '/courses/:id',
    ah(async (req, res) => {
      const id = req.params.id ?? '';
      if (!(await courseExists(db, id))) return courseNotFound(res);
      const parsed = CourseSchema.safeParse(req.body);
      if (!parsed.success) {
        return back(
          req,
          res,
          `/admin/courses/${id}/edit`,
          firstError(parsed.error),
          formValues(req.body),
        );
      }
      await updateCourse(db, id, parsed.data);
      done(req, res, `/courses/${id}`, 'Course saved.');
    }),
  );

  router.get(
    '/courses/:id/delete',
    ah(async (req, res) => {
      const course = await getCourse(db, req.params.id ?? '');
      if (!course) return courseNotFound(res);
      res.render('admin/confirm.njk', {
        pageTitle: 'Delete course',
        formPage: true,
        heading: `Delete “${course.name}”?`,
        message: `This removes the course, its ${course.material_count + course.hidden_count} material(s) and its announcements. Students will no longer see them. This cannot be undone.`,
        action: `/admin/courses/${course.id}/delete`,
        cancel: `/courses/${course.id}`,
        label: 'Delete course',
      });
    }),
  );

  router.post(
    '/courses/:id/delete',
    ah(async (req, res) => {
      const id = req.params.id ?? '';
      if (!(await courseExists(db, id))) return courseNotFound(res);
      if (req.body?.confirmed !== '1') return res.redirect(303, `/admin/courses/${id}/delete`);
      const fileIds = await deleteCourse(db, id);
      await Promise.all(fileIds.map((f) => removeQuietly(storage, f)));
      done(req, res, '/admin', 'Course deleted.');
    }),
  );

  return router;
}
