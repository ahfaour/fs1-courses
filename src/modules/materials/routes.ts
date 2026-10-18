import { Router, type Request, type Response } from 'express';
import type { Queryable } from '../../db/connection.js';
import type { AppDeps } from '../../deps.js';
import { todayIso } from '../../lib/format.js';
import { ah, back, done, renderError } from '../../lib/http.js';
import { randomId } from '../../lib/ids.js';
import { firstError, formValues } from '../../lib/validation.js';
import { verifyCsrf } from '../auth/csrf.js';
import { getCourse, type Course } from '../courses/queries.js';
import { deleteFileIfUnreferenced, insertFile, type FileRow } from '../files/queries.js';
import { removeQuietly } from '../files/storage.js';
import {
  ALLOWED_TYPES,
  TYPE_MESSAGE,
  UploadRejected,
  sizeMessage,
  storeUpload,
  uploadSingle,
} from '../files/upload.js';
import {
  deleteMaterial,
  getMaterial,
  insertMaterial,
  moveMaterial,
  updateMaterial,
} from './queries.js';
import { MaterialSchema } from './schema.js';
import { sectionsFor } from './sections.js';

const UPLOAD_FAILED = 'Upload failed. Try again, or share a link instead.';

const materialNotFound = (res: Response) =>
  renderError(res, 404, 'Material not found', 'It may already have been deleted.');

type NewFile = Omit<FileRow, 'created_at'>;

/** Admin: create, edit and delete materials (multipart forms with an optional file). */
export function materialsAdminRouter(deps: AppDeps): Router {
  const { db, storage, config } = deps;
  const router = Router();
  const upload = uploadSingle(deps);

  const renderForm = (
    res: Response,
    course: Course,
    opts: { title: string; action: string; v: unknown; currentFile?: string | null },
  ) =>
    res.render('admin/material-form.njk', {
      pageTitle: opts.title,
      formPage: true,
      course,
      sectionOptions: sectionsFor(course.kind).map((s) => [
        s.key,
        s.fr ? `${s.label} (${s.fr})` : s.label,
      ]),
      maxUploadMb: config.maxUploadMb,
      accept: Object.keys(ALLOWED_TYPES)
        .map((e) => `.${e}`)
        .join(','),
      urlHint: opts.currentFile
        ? 'Google Drive, GitHub, Moodle, a video… Leave empty to keep the current file.'
        : 'Google Drive, GitHub, Moodle, a video… If you also upload a file, the file is used.',
      ...opts,
    });

  /**
   * Shared by create and update: validates fields and stores the uploaded file, if any.
   * Returns null after it has already responded (validation error or upload failure).
   */
  async function readForm(
    req: Request,
    res: Response,
    course: Course,
    formUrl: string,
  ): Promise<{ data: ReturnType<typeof MaterialSchema.parse>; file: NewFile | null } | null> {
    const fail = (msg: string) => {
      back(req, res, formUrl, msg, formValues(req.body));
      return null;
    };
    if (req.uploadRejected === 'size') return fail(sizeMessage(config.maxUploadMb));
    if (req.uploadRejected === 'type') return fail(TYPE_MESSAGE);

    const parsed = MaterialSchema.safeParse(req.body);
    if (!parsed.success) return fail(firstError(parsed.error));
    if (!sectionsFor(course.kind).some((s) => s.key === parsed.data.section)) {
      return fail('Program information is only available for programs.');
    }

    if (!req.file) return { data: parsed.data, file: null };
    try {
      return { data: parsed.data, file: await storeUpload(deps, req.file) };
    } catch (err) {
      if (err instanceof UploadRejected) return fail(err.message);
      console.error('Upload could not be stored:', err);
      renderError(res, 500, 'Upload failed', UPLOAD_FAILED);
      return null;
    }
  }

  /** Runs the DB write; on failure removes the file that was just stored and shows an error. */
  async function commit(
    res: Response,
    file: NewFile | null,
    write: (q: Queryable) => Promise<void>,
  ): Promise<boolean> {
    try {
      await db.tx(async (q) => {
        if (file) await insertFile(q, file);
        await write(q);
      });
      return true;
    } catch (err) {
      console.error('Saving the material failed:', err);
      await removeQuietly(storage, file?.id);
      renderError(res, 500, 'Could not save', 'The material was not saved. Try again.');
      return false;
    }
  }

  router.get(
    '/courses/:id/materials/new',
    ah(async (req, res) => {
      const course = await getCourse(db, req.params.id ?? '');
      if (!course)
        return renderError(res, 404, 'Course not found', 'Pick a course from the index.');
      const section = typeof req.query.section === 'string' ? req.query.section : 'cours';
      renderForm(res, course, {
        title: `Add material · ${course.name}`,
        action: `/admin/courses/${course.id}/materials`,
        v: res.locals.flash?.values ?? { section, material_date: todayIso() },
      });
    }),
  );

  router.post(
    '/courses/:id/materials',
    upload,
    verifyCsrf,
    ah(async (req, res) => {
      const course = await getCourse(db, req.params.id ?? '');
      if (!course)
        return renderError(res, 404, 'Course not found', 'Pick a course from the index.');
      const form = await readForm(req, res, course, `/admin/courses/${course.id}/materials/new`);
      if (!form) return;
      const { data, file } = form;
      // A file wins over a link when both are given.
      if (!file && !data.url) {
        return back(
          req,
          res,
          `/admin/courses/${course.id}/materials/new`,
          'Upload a file or paste a link.',
          formValues(req.body),
        );
      }
      const ok = await commit(res, file, (q) =>
        insertMaterial(q, randomId(), course.id, {
          ...data,
          url: file ? null : data.url,
          file_id: file?.id ?? null,
        }),
      );
      if (ok) done(req, res, `/courses/${course.id}#sec-${data.section}`, 'Material added.');
    }),
  );

  router.get(
    '/materials/:id/edit',
    ah(async (req, res) => {
      const m = await getMaterial(db, req.params.id ?? '');
      const course = m && (await getCourse(db, m.course_id));
      if (!m || !course) return materialNotFound(res);
      renderForm(res, course, {
        title: 'Edit material',
        action: `/admin/materials/${m.id}`,
        v: res.locals.flash?.values ?? { ...m, url: m.url ?? '' },
        currentFile: m.file_id ? m.original_name : null,
      });
    }),
  );

  router.post(
    '/materials/:id',
    upload,
    verifyCsrf,
    ah(async (req, res) => {
      const m = await getMaterial(db, req.params.id ?? '');
      const course = m && (await getCourse(db, m.course_id));
      if (!m || !course) return materialNotFound(res);
      const formUrl = `/admin/materials/${m.id}/edit`;
      const form = await readForm(req, res, course, formUrl);
      if (!form) return;
      const { data, file } = form;

      // Next source: a new file, else a link, else keep the current file.
      let url: string | null = null;
      let fileId: string | null = null;
      if (file) fileId = file.id;
      else if (data.url) url = data.url;
      else if (m.file_id) fileId = m.file_id;
      else return back(req, res, formUrl, 'Upload a file or paste a link.', formValues(req.body));

      let oldFileGone = false;
      const ok = await commit(res, file, async (q) => {
        await updateMaterial(q, m.id, { ...data, url, file_id: fileId });
        if (m.file_id && m.file_id !== fileId) {
          oldFileGone = await deleteFileIfUnreferenced(q, m.file_id);
        }
      });
      if (!ok) return;
      if (oldFileGone) await removeQuietly(storage, m.file_id);
      done(req, res, `/courses/${course.id}#sec-${data.section}`, 'Material saved.');
    }),
  );

  router.get(
    '/materials/:id/delete',
    ah(async (req, res) => {
      const m = await getMaterial(db, req.params.id ?? '');
      if (!m) return materialNotFound(res);
      res.render('admin/confirm.njk', {
        pageTitle: 'Delete material',
        formPage: true,
        heading: `Delete “${m.title}”?`,
        message: 'Students will no longer see it. This cannot be undone.',
        action: `/admin/materials/${m.id}/delete`,
        cancel: `/courses/${m.course_id}`,
        label: 'Delete',
      });
    }),
  );

  router.post(
    '/materials/:id/delete',
    ah(async (req, res) => {
      const m = await getMaterial(db, req.params.id ?? '');
      if (!m) return materialNotFound(res);
      if (req.body?.confirmed !== '1') return res.redirect(303, `/admin/materials/${m.id}/delete`);
      const fileId = await deleteMaterial(db, m.id);
      await removeQuietly(storage, fileId);
      done(req, res, `/courses/${m.course_id}#sec-${m.section}`, 'Material deleted.');
    }),
  );

  // ↑ / ↓ on the course page. Not a form page: no flash message, straight back to the section.
  router.post(
    '/materials/:id/move',
    ah(async (req, res) => {
      const direction = req.body?.direction;
      if (direction !== 'up' && direction !== 'down') return materialNotFound(res);
      const m = await moveMaterial(db, req.params.id ?? '', direction);
      if (!m) return materialNotFound(res);
      res.redirect(303, `/courses/${m.course_id}#sec-${m.section}`);
    }),
  );

  return router;
}
