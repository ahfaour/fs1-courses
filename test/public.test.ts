import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { insertAnnouncement } from '../src/modules/announcements/queries.js';
import { insertMaterial } from '../src/modules/materials/queries.js';
import { makeApp } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  ctx = await makeApp();
});
afterEach(() => ctx.cleanup());

const link = (title: string, note = '', section: 'cours' | 'tp' = 'cours') => ({
  section,
  title,
  note,
  material_date: '2026-10-17',
  url: 'https://example.com/x',
  file_id: null,
  hidden: false,
});

describe('public pages', () => {
  it('overview lists the seeded courses and says there are no announcements', async () => {
    const res = await request(ctx.app).get('/').expect(200);
    for (const name of [
      'Machine Learning',
      'Operating Systems',
      'Relational Databases',
      'Natural Language Processing',
      'GeoAI Professional Master 2',
    ]) {
      expect(res.text).toContain(name);
    }
    expect(res.text).toContain('No announcements right now.');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('offers a light / dark toggle, loaded before the page is drawn', async () => {
    const res = await request(ctx.app).get('/').expect(200);
    expect(res.text).toContain('data-theme-toggle');
    const head = res.text.slice(0, res.text.indexOf('</head>'));
    // Fingerprinted so browsers drop a cached copy after a deploy.
    expect(head).toMatch(/<script src="\/js\/theme\.js\?v=[0-9a-f]{10}"><\/script>/);
    expect(head).toMatch(/href="\/css\/site\.css\?v=[0-9a-f]{10}"/);
    const js = await request(ctx.app).get('/js/theme.js').expect(200);
    expect(js.text).toContain('localStorage');
  });

  it('shows announcements newest first, with the course tag', async () => {
    await insertAnnouncement(ctx.db, 'a1', {
      course_id: null,
      body: 'Older note',
      posted_on: '2026-09-01',
    });
    await insertAnnouncement(ctx.db, 'a2', {
      course_id: 'os',
      body: 'Newer note',
      posted_on: '2026-10-01',
    });
    const res = await request(ctx.app).get('/').expect(200);
    expect(res.text.indexOf('Newer note')).toBeLessThan(res.text.indexOf('Older note'));
    expect(res.text).toContain('1 Oct 2026');
    expect(res.text).not.toContain('No announcements right now.');
  });

  it('renders a course page and 404s an unknown one', async () => {
    const os = await request(ctx.app).get('/courses/os').expect(200);
    expect(os.text).toContain('Operating Systems');
    expect(os.text).toContain('CPU scheduling');
    expect(os.text).toContain('Materials for this course will be posted here.');
    expect(os.text).toContain('aria-current="page"');

    const missing = await request(ctx.app).get('/courses/does-not-exist').expect(404);
    expect(missing.text).toContain('Course not found');
  });

  it('groups materials by section and hides empty sections', async () => {
    await insertMaterial(ctx.db, 'm1', 'os', link('Lab 1: fork()', '', 'tp'));
    const res = await request(ctx.app).get('/courses/os').expect(200);
    expect(res.text).toContain('Labs');
    expect(res.text).toContain('Lab 1: fork()');
    expect(res.text).not.toContain('Tutorials');
    expect(res.text).toContain('LINK');
    expect(res.text).toContain('rel="noopener noreferrer"');
  });

  it('search finds a material by a word in its note', async () => {
    await insertMaterial(
      ctx.db,
      'm1',
      'rdb',
      link('Exercise sheet 2', 'Covers normalisation and BCNF'),
    );
    const res = await request(ctx.app).get('/search?q=bcnf').expect(200);
    expect(res.text).toContain('Exercise sheet 2');
    expect(res.text).toContain('Relational Databases');
  });

  it('search treats % and _ literally', async () => {
    await insertMaterial(ctx.db, 'm1', 'ml', link('Grades', 'Worth 40% of the mark'));
    await insertMaterial(ctx.db, 'm2', 'ml', link('Plain title', 'nothing special'));
    const pct = await request(ctx.app).get('/search?q=%25').expect(200);
    expect(pct.text).toContain('Grades');
    expect(pct.text).not.toContain('Plain title');

    const under = await request(ctx.app).get('/search?q=_').expect(200);
    expect(under.text).toContain('Nothing matches “_”.');
  });

  it('search caps the query at 100 characters', async () => {
    const res = await request(ctx.app)
      .get(`/search?q=${'a'.repeat(150)}`)
      .expect(200);
    expect(res.text).toContain(`value="${'a'.repeat(100)}"`);
    expect(res.text).not.toContain('a'.repeat(101));
  });

  it('stored HTML renders escaped', async () => {
    await insertMaterial(
      ctx.db,
      'm1',
      'os',
      link('<script>alert(1)</script>', '<img src=x onerror=alert(1)>'),
    );
    await insertAnnouncement(ctx.db, 'a1', {
      course_id: null,
      body: '<script>bad()</script>',
      posted_on: '2026-10-01',
    });
    const course = await request(ctx.app).get('/courses/os').expect(200);
    expect(course.text).not.toContain('<script>alert(1)</script>');
    expect(course.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(course.text).not.toContain('<img src=x');
    const home = await request(ctx.app).get('/').expect(200);
    expect(home.text).not.toContain('<script>bad()</script>');
    expect(home.text).toContain('&lt;script&gt;bad()&lt;/script&gt;');
  });

  it('healthz answers ok', async () => {
    const res = await request(ctx.app).get('/healthz').expect(200);
    expect(res.text).toBe('ok');
  });

  it('healthz does not touch the database', async () => {
    // Render calls /healthz every few seconds; a query there keeps a scale-to-zero database awake.
    const unreachable = () => Promise.reject(new Error('healthz must not query the database'));
    const db = { ...ctx.db, query: unreachable, run: unreachable, exec: unreachable };
    const app = createApp({ config: ctx.config, db, storage: ctx.storage });
    const res = await request(app).get('/healthz').expect(200);
    expect(res.text).toBe('ok');
  });

  it('a visitor gets no session cookie', async () => {
    const res = await request(ctx.app).get('/courses/os').expect(200);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
