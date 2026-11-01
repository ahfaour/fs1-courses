import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, PDF, csrfFrom, makeApp } from './helpers.js';

const BASE = '/lufs1-courses';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  ctx = await makeApp({ basePath: BASE });
});
afterEach(() => ctx.cleanup());

/** Every root-relative link, form target and asset on a page that misses the prefix. */
const escaped = (html: string) =>
  [...html.matchAll(/\b(?:href|action|src)="(\/[^"]*)"/g)]
    .map((m) => m[1] as string)
    .filter((url) => url !== BASE && !url.startsWith(`${BASE}/`));

async function signIn() {
  const agent = request.agent(ctx.app);
  const page = await agent.get(`${BASE}/admin/login`).expect(200);
  const res = await agent
    .post(`${BASE}/admin/login`)
    .type('form')
    .send({ _csrf: csrfFrom(page.text), email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    .expect(303);
  return { agent, res };
}

describe('served under BASE_PATH', () => {
  it('normalises the setting and refuses anything that is not a path', () => {
    const load = (BASE_PATH: string) => loadConfig({ BASE_PATH }).basePath;
    expect(load('')).toBe('');
    expect(load('/')).toBe('');
    expect(load('lufs1-courses/')).toBe(BASE);
    expect(() => load('/a b')).toThrow(/BASE_PATH/);
  });

  it('answers with and without the trailing slash', async () => {
    await request(ctx.app).get(BASE).expect(200);
    await request(ctx.app).get(`${BASE}/`).expect(200);
    await request(ctx.app).get(`${BASE}?x=1`).expect(200);
  });

  it('keeps every public link under the prefix, assets included', async () => {
    for (const path of ['/', '/courses/ml', '/search?q=ml', '/no-such-page']) {
      const res = await request(ctx.app).get(BASE + path);
      expect(escaped(res.text), path).toEqual([]);
    }
    const home = (await request(ctx.app).get(BASE).expect(200)).text;
    expect(home).toContain(`data-base="${BASE}"`);
    const css = /href="([^"]+site\.css[^"]*)"/.exec(home)?.[1];
    await request(ctx.app)
      .get(css as string)
      .expect(200);
  });

  it('keeps the health check at the root for the deploy hook', async () => {
    await request(ctx.app).get('/healthz').expect(200);
  });

  it('does not take a longer path for the prefix', async () => {
    await request(ctx.app).get(`${BASE}x`).expect(404);
  });

  it('scopes the session cookie and clears it on sign-out', async () => {
    const { agent, res } = await signIn();
    expect(res.headers.location).toBe(`${BASE}/admin`);
    expect(String(res.headers['set-cookie'])).toContain(`Path=${BASE};`);

    const dash = await agent.get(`${BASE}/admin`).expect(200);
    const out = await agent
      .post(`${BASE}/admin/logout`)
      .type('form')
      .send({ _csrf: csrfFrom(dash.text) })
      .expect(303);
    expect(out.headers.location).toBe(`${BASE}/`);
    expect(String(out.headers['set-cookie'])).toContain(`Path=${BASE};`);
    await agent.get(`${BASE}/admin`).expect(303);
  });

  it('keeps every admin link under the prefix', async () => {
    const { agent } = await signIn();
    for (const path of [
      '/',
      '/admin',
      '/admin/profile',
      '/admin/courses/new',
      '/admin/courses/ml/edit',
      '/admin/courses/ml/materials/new',
      '/admin/courses/ml/delete',
      '/admin/announcements/new',
    ]) {
      const res = await agent.get(BASE + path);
      expect(res.status, path).toBe(200);
      expect(escaped(res.text), path).toEqual([]);
    }
  });

  it('returns to the page asked for after sign-in, with one prefix', async () => {
    const agent = request.agent(ctx.app);
    const sent = await agent.get(`${BASE}/admin/profile`).expect(303);
    expect(sent.headers.location).toBe(`${BASE}/admin/login`);
    const page = await agent.get(`${BASE}/admin/login`).expect(200);
    const res = await agent
      .post(`${BASE}/admin/login`)
      .type('form')
      .send({ _csrf: csrfFrom(page.text), email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(303);
    expect(res.headers.location).toBe(`${BASE}/admin/profile`);
  });

  it('returns to the form page when a POST arrives signed out', async () => {
    const agent = request.agent(ctx.app);
    await agent
      .post(`${BASE}/admin/profile`)
      .set('Host', 'edufs.test')
      .set('Referer', `http://edufs.test${BASE}/courses/ml?x=1`)
      .type('form')
      .send({})
      .expect(303);
    const page = await agent.get(`${BASE}/admin/login`).expect(200);
    const res = await agent
      .post(`${BASE}/admin/login`)
      .type('form')
      .send({ _csrf: csrfFrom(page.text), email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(303);
    expect(res.headers.location).toBe(`${BASE}/courses/ml?x=1`);
  });

  it('uploads a file and links to it under the prefix', async () => {
    const { agent } = await signIn();
    const dash = await agent.get(`${BASE}/admin`).expect(200);
    const added = await agent
      .post(`${BASE}/admin/courses/os/materials`)
      .field('_csrf', csrfFrom(dash.text))
      .field('title', 'Slides')
      .field('section', 'tp')
      .attach('file', PDF, 'slides.pdf')
      .expect(303);
    expect(added.headers.location).toBe(`${BASE}/courses/os#sec-tp`);

    const page = await request(ctx.app).get(`${BASE}/courses/os`).expect(200);
    const link = /href="([^"]*\/files\/[^"]+)"/.exec(page.text)?.[1] as string;
    expect(link.startsWith(`${BASE}/files/`)).toBe(true);
    const file = await request(ctx.app).get(link).expect(200);
    expect(Buffer.from(file.body as Buffer).equals(PDF)).toBe(true);
  });

  it('leaves external redirects and links alone', async () => {
    const { res } = await signIn();
    expect(String(res.headers.location).startsWith(`${BASE}/`)).toBe(true);
    expect(escaped('<a href="https://example.com/x">x</a>')).toEqual([]);
  });
});

describe('served at the root (the default)', () => {
  it('has no prefix in links or the cookie', async () => {
    const root = await makeApp();
    try {
      const page = await request(root.app).get('/admin/login').expect(200);
      expect(page.text).toContain('action="/admin/login"');
      expect(page.text).toContain('data-base=""');
      expect(String(page.headers['set-cookie'])).toContain('Path=/;');
    } finally {
      root.cleanup();
    }
  });
});
