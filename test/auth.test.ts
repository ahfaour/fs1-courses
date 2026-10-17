import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_EMAIL, ADMIN_PASSWORD, csrfFrom, makeApp, signIn } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  ctx = await makeApp();
});
afterEach(() => ctx.cleanup());

const ADMIN_GETS = [
  '/admin',
  '/admin/profile',
  '/admin/courses/new',
  '/admin/courses/os/edit',
  '/admin/courses/os/delete',
  '/admin/courses/os/materials/new',
  '/admin/materials/x/edit',
  '/admin/materials/x/delete',
  '/admin/announcements/new',
  '/admin/announcements/x/delete',
];
const ADMIN_POSTS = [
  '/admin/logout',
  '/admin/profile',
  '/admin/courses',
  '/admin/courses/os',
  '/admin/courses/os/delete',
  '/admin/courses/os/materials',
  '/admin/materials/x',
  '/admin/materials/x/delete',
  '/admin/announcements',
  '/admin/announcements/x/delete',
];

async function loginAttempt(agent: ReturnType<typeof request.agent>, password: string) {
  const page = await agent.get('/admin/login');
  return agent
    .post('/admin/login')
    .type('form')
    .send({ _csrf: csrfFrom(page.text), email: ADMIN_EMAIL, password });
}

describe('authorization', () => {
  it('every admin route except login redirects to login when signed out', async () => {
    for (const path of ADMIN_GETS) {
      const res = await request(ctx.app).get(path);
      expect(res.status, `GET ${path}`).toBe(303);
      expect(res.headers.location, `GET ${path}`).toBe('/admin/login');
    }
    for (const path of ADMIN_POSTS) {
      const res = await request(ctx.app).post(path).type('form').send({ name: 'x' });
      expect(res.status, `POST ${path}`).toBe(303);
      expect(res.headers.location, `POST ${path}`).toBe('/admin/login');
    }
    await request(ctx.app).get('/admin/login').expect(200);
  });

  it('a signed-out POST changes nothing', async () => {
    await request(ctx.app).post('/admin/courses/os/delete').type('form').send({ confirmed: '1' });
    await request(ctx.app).get('/courses/os').expect(200);
  });

  it('sends the admin back to the page they asked for after signing in', async () => {
    const agent = request.agent(ctx.app);
    await agent.get('/admin/courses/os/edit').expect(303);
    const res = await loginAttempt(agent, ADMIN_PASSWORD);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/admin/courses/os/edit');
  });
});

describe('CSRF', () => {
  it('rejects an admin POST without a valid token', async () => {
    const { agent } = await signIn(ctx.app);
    await agent
      .post('/admin/courses')
      .type('form')
      .send({ name: 'Compilers', kind: 'course' })
      .expect(403);
    await agent
      .post('/admin/courses')
      .type('form')
      .send({ _csrf: 'wrong', name: 'Compilers', kind: 'course' })
      .expect(403);
    await agent
      .post('/admin/courses/os/materials')
      .field('title', 'No token')
      .field('section', 'cours')
      .field('url', 'https://example.com')
      .expect(403);
    const home = await agent.get('/').expect(200);
    expect(home.text).not.toContain('Compilers');
  });

  it('rejects a login POST without a token', async () => {
    await request(ctx.app)
      .post('/admin/login')
      .type('form')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(403);
  });
});

describe('login', () => {
  it('shows the same generic error for a wrong password and an unknown email', async () => {
    const agent = request.agent(ctx.app);
    const wrong = await loginAttempt(agent, 'not the password');
    expect(wrong.status).toBe(401);
    expect(wrong.text).toContain('Email or password is incorrect.');

    const page = await agent.get('/admin/login');
    const unknown = await agent
      .post('/admin/login')
      .type('form')
      .send({ _csrf: csrfFrom(page.text), email: 'nobody@example.com', password: 'whatever' });
    expect(unknown.status).toBe(401);
    expect(unknown.text).toContain('Email or password is incorrect.');
  });

  it('returns 429 on the 6th failed attempt in 15 minutes', async () => {
    const agent = request.agent(ctx.app);
    for (let i = 1; i <= 5; i++) {
      const res = await loginAttempt(agent, `wrong-${i}`);
      expect(res.status, `attempt ${i}`).toBe(401);
    }
    const sixth = await loginAttempt(agent, 'wrong-6');
    expect(sixth.status).toBe(429);
    // Even the right password is refused until the window passes.
    expect((await loginAttempt(agent, ADMIN_PASSWORD)).status).toBe(429);
  });

  it('sets a hardened cookie, regenerates the session id and signs out', async () => {
    const agent = request.agent(ctx.app);
    const page = await agent.get('/admin/login');
    const before = String(page.headers['set-cookie']).split(';')[0];
    const res = await agent
      .post('/admin/login')
      .type('form')
      .send({ _csrf: csrfFrom(page.text), email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(303);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie.split(';')[0]).not.toBe(before);

    const dash = await agent.get('/admin').expect(200);
    expect(dash.text).toContain('Signed in as admin@example.com');
    expect(dash.headers['cache-control']).toBe('no-store');
    await agent
      .post('/admin/logout')
      .type('form')
      .send({ _csrf: csrfFrom(dash.text) })
      .expect(303);
    await agent.get('/admin').expect(303);
  });
});
