import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listAnnouncements } from '../src/modules/announcements/queries.js';
import { getCourse } from '../src/modules/courses/queries.js';
import { listForCourse } from '../src/modules/materials/queries.js';
import { PDF, makeApp, signIn } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let agent: Awaited<ReturnType<typeof signIn>>['agent'];
let csrf: string;
beforeEach(async () => {
  ctx = await makeApp();
  ({ agent, csrf } = await signIn(ctx.app));
});
afterEach(() => ctx.cleanup());

const storedFiles = () => fs.readdirSync(ctx.config.uploadDir).filter((f) => f !== '.tmp');

function addMaterial(courseId: string, fields: Record<string, string>) {
  let req = agent.post(`/admin/courses/${courseId}/materials`).field('_csrf', csrf);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req;
}

describe('profile', () => {
  it('updates the profile and shows it publicly', async () => {
    await agent
      .post('/admin/profile')
      .type('form')
      .send({
        _csrf: csrf,
        name: 'Dr. Rana Haddad',
        title: 'Instructor',
        affiliation: 'Lebanese University',
        intro: 'Bienvenue — مرحبا',
        email: 'rana@example.com',
        office_hours: 'Tue 10:00–12:00',
      })
      .expect(303);
    const home = await request(ctx.app).get('/').expect(200);
    expect(home.text).toContain('Dr. Rana Haddad');
    expect(home.text).toContain('Bienvenue — مرحبا');
    expect(home.text).toContain('rana@example.com');
  });

  it('rejects an invalid email and keeps what was typed', async () => {
    const res = await agent
      .post('/admin/profile')
      .type('form')
      .send({ _csrf: csrf, name: 'Kept name', email: 'not-an-email' })
      .expect(303);
    expect(res.headers.location).toBe('/admin/profile');
    const form = await agent.get('/admin/profile').expect(200);
    expect(form.text).toContain('Enter a valid email address');
    expect(form.text).toContain('value="Kept name"');
  });
});

describe('courses', () => {
  it('creates a course with a unique slug from the name', async () => {
    const send = (name: string) =>
      agent.post('/admin/courses').type('form').send({ _csrf: csrf, name, kind: 'course' });
    const first = await send('Systèmes d’exploitation').expect(303);
    expect(first.headers.location).toBe('/courses/systemes-d-exploitation');
    const second = await send('Systèmes d’exploitation').expect(303);
    expect(second.headers.location).toBe('/courses/systemes-d-exploitation-2');
    const page = await request(ctx.app).get('/courses/systemes-d-exploitation').expect(200);
    expect(page.text).toContain('Systèmes d’exploitation');
  });

  it('updates a course and keeps its slug', async () => {
    await agent
      .post('/admin/courses/os')
      .type('form')
      .send({
        _csrf: csrf,
        name: 'Operating Systems II',
        code: 'I3302',
        level: 'L3',
        semester: 'Fall 2026–27',
        kind: 'course',
        description: 'New text',
        topics: 'Kernels\nDrivers',
        color_index: '5',
        sort_order: '1',
      })
      .expect(303);
    const c = await getCourse(ctx.db, 'os');
    expect(c?.name).toBe('Operating Systems II');
    expect(c?.topics).toEqual(['Kernels', 'Drivers']);
    expect(c?.color_index).toBe(5);
  });

  it('enforces field limits', async () => {
    await agent
      .post('/admin/courses')
      .type('form')
      .send({ _csrf: csrf, name: 'x'.repeat(121), kind: 'course' })
      .expect(303);
    const form = await agent.get('/admin/courses/new').expect(200);
    expect(form.text).toContain('Name can be at most 120 characters.');
  });

  it('deleting a course asks for confirmation first', async () => {
    const res = await agent
      .post('/admin/courses/os/delete')
      .type('form')
      .send({ _csrf: csrf })
      .expect(303);
    expect(res.headers.location).toBe('/admin/courses/os/delete');
    expect(await getCourse(ctx.db, 'os')).toBeDefined();
  });

  it('deleting a course removes its materials, announcements and files', async () => {
    await addMaterial('os', { title: 'Slides', section: 'cours' })
      .attach('file', PDF, 'slides.pdf')
      .expect(303);
    await agent
      .post('/admin/announcements')
      .type('form')
      .send({ _csrf: csrf, body: 'OS midterm moved', course_id: 'os', posted_on: '2026-10-20' })
      .expect(303);
    await agent
      .post('/admin/announcements')
      .type('form')
      .send({ _csrf: csrf, body: 'General note', course_id: '' })
      .expect(303);
    expect(await listForCourse(ctx.db, 'os')).toHaveLength(1);
    expect(storedFiles()).toHaveLength(1);

    await agent
      .post('/admin/courses/os/delete')
      .type('form')
      .send({ _csrf: csrf, confirmed: '1' })
      .expect(303);
    expect(await getCourse(ctx.db, 'os')).toBeUndefined();
    expect(await listForCourse(ctx.db, 'os')).toHaveLength(0);
    expect((await listAnnouncements(ctx.db)).map((a) => a.body)).toEqual(['General note']);
    expect(await ctx.db.query('SELECT COUNT(*)::int AS n FROM files')).toEqual([{ n: 0 }]);
    expect(storedFiles()).toHaveLength(0);
    await request(ctx.app).get('/courses/os').expect(404);
  });
});

describe('materials', () => {
  it('rejects a material with neither file nor URL', async () => {
    const res = await addMaterial('os', { title: 'Nothing attached', section: 'tp' }).expect(303);
    expect(res.headers.location).toBe('/admin/courses/os/materials/new');
    const form = await agent.get(res.headers.location as string).expect(200);
    expect(form.text).toContain('Upload a file or paste a link.');
    expect(form.text).toContain('value="Nothing attached"');
    expect(await listForCourse(ctx.db, 'os')).toHaveLength(0);
  });

  it('when both a file and a URL are sent, the file wins', async () => {
    await addMaterial('os', { title: 'Both', section: 'cours', url: 'https://example.com/a' })
      .attach('file', PDF, 'both.pdf')
      .expect(303);
    const [m] = await listForCourse(ctx.db, 'os');
    expect(m?.file_id).toBeTruthy();
    expect(m?.url).toBeNull();
  });

  it('rejects javascript: and data: URLs', async () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com/x']) {
      await addMaterial('os', { title: 'Bad link', section: 'cours', url }).expect(303);
      const form = await agent.get('/admin/courses/os/materials/new');
      expect(form.text, url).toContain('Links must start with http:// or https://');
    }
    expect(await listForCourse(ctx.db, 'os')).toHaveLength(0);
  });

  it('an admin adds a PDF to Operating Systems → Labs and a student sees it at once', async () => {
    const res = await addMaterial('os', {
      title: 'Lab 3 – Threads',
      section: 'tp',
      material_date: '2026-10-17',
      note: 'Bring your laptop',
    })
      .attach('file', PDF, 'lab3.pdf')
      .expect(303);
    expect(res.headers.location).toBe('/courses/os#sec-tp');
    const page = await request(ctx.app).get('/courses/os').expect(200);
    expect(page.text).toContain('Lab 3 – Threads');
    expect(page.text).toContain('17 Oct 2026');
    expect(page.text).toContain('>PDF<');
    expect(page.text).not.toContain('Materials for this course will be posted here.');
  });

  it('section "Program information" is refused for a course', async () => {
    await addMaterial('os', { title: 'Info', section: 'info', url: 'https://example.com' }).expect(
      303,
    );
    expect(await listForCourse(ctx.db, 'os')).toHaveLength(0);
    await addMaterial('geoai', {
      title: 'Schedule',
      section: 'info',
      url: 'https://example.com',
    }).expect(303);
    expect(await listForCourse(ctx.db, 'geoai')).toHaveLength(1);
  });

  it('editing with a new file replaces and deletes the old one', async () => {
    await addMaterial('os', { title: 'v1', section: 'cours' })
      .attach('file', PDF, 'v1.pdf')
      .expect(303);
    const [m] = await listForCourse(ctx.db, 'os');
    const oldFile = m!.file_id!;
    expect(storedFiles()).toEqual([oldFile]);

    await agent
      .post(`/admin/materials/${m!.id}`)
      .field('_csrf', csrf)
      .field('title', 'v2')
      .field('section', 'cours')
      .attach('file', Buffer.concat([PDF, Buffer.from('% v2\n')]), 'v2.pdf')
      .expect(303);
    const [after] = await listForCourse(ctx.db, 'os');
    expect(after?.title).toBe('v2');
    expect(after?.file_id).not.toBe(oldFile);
    expect(storedFiles()).toEqual([after!.file_id]);

    // No new file and no URL keeps the current file.
    await agent
      .post(`/admin/materials/${m!.id}`)
      .field('_csrf', csrf)
      .field('title', 'v3')
      .field('section', 'td')
      .expect(303);
    const [kept] = await listForCourse(ctx.db, 'os');
    expect(kept?.file_id).toBe(after?.file_id);
    expect(kept?.section).toBe('td');

    // Switching to a link removes the file.
    await agent
      .post(`/admin/materials/${m!.id}`)
      .field('_csrf', csrf)
      .field('title', 'v4')
      .field('section', 'td')
      .field('url', 'https://github.com/example/repo')
      .expect(303);
    const [linked] = await listForCourse(ctx.db, 'os');
    expect(linked?.url).toBe('https://github.com/example/repo');
    expect(linked?.file_id).toBeNull();
    expect(storedFiles()).toEqual([]);
  });

  it('deleting a material removes its file from disk', async () => {
    await addMaterial('os', { title: 'Temp', section: 'cours' })
      .attach('file', PDF, 't.pdf')
      .expect(303);
    const [m] = await listForCourse(ctx.db, 'os');
    expect(fs.existsSync(path.join(ctx.config.uploadDir, m!.file_id!))).toBe(true);
    await agent
      .post(`/admin/materials/${m!.id}/delete`)
      .type('form')
      .send({ _csrf: csrf, confirmed: '1' })
      .expect(303);
    expect(await listForCourse(ctx.db, 'os')).toHaveLength(0);
    expect(storedFiles()).toEqual([]);
  });
});

describe('announcements', () => {
  it('posts and deletes an announcement', async () => {
    await agent
      .post('/admin/announcements')
      .type('form')
      .send({ _csrf: csrf, body: 'Labs start next week.\nBring a laptop.', course_id: 'nlp' })
      .expect(303);
    const home = await request(ctx.app).get('/').expect(200);
    expect(home.text).toContain('Labs start next week.\nBring a laptop.');
    const [a] = await listAnnouncements(ctx.db);
    await agent
      .post(`/admin/announcements/${a!.id}/delete`)
      .type('form')
      .send({ _csrf: csrf, confirmed: '1' })
      .expect(303);
    const after = await request(ctx.app).get('/').expect(200);
    expect(after.text).toContain('No announcements right now.');
  });

  it('rejects an unknown course and an over-long body', async () => {
    await agent
      .post('/admin/announcements')
      .type('form')
      .send({ _csrf: csrf, body: 'x', course_id: 'nope' })
      .expect(303);
    await agent
      .post('/admin/announcements')
      .type('form')
      .send({ _csrf: csrf, body: 'x'.repeat(1001) })
      .expect(303);
    expect(await listAnnouncements(ctx.db)).toHaveLength(0);
  });
});
