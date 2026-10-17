import fs from 'node:fs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listForCourse } from '../src/modules/materials/queries.js';
import { PDF, makeApp, signIn } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let agent: Awaited<ReturnType<typeof signIn>>['agent'];
let csrf: string;
beforeEach(async () => {
  ctx = await makeApp(); // MAX_UPLOAD_MB = 1 in tests
  ({ agent, csrf } = await signIn(ctx.app));
});
afterEach(() => ctx.cleanup());

const diskEntries = () => [
  ...fs.readdirSync(ctx.config.uploadDir).filter((f) => f !== '.tmp'),
  ...fs.readdirSync(ctx.storage.tempDir),
];

const upload = (file: Buffer, name: string, title = 'Upload') =>
  agent
    .post('/admin/courses/os/materials')
    .field('_csrf', csrf)
    .field('title', title)
    .field('section', 'tp')
    .attach('file', file, name);

async function errorShown() {
  return (await agent.get('/admin/courses/os/materials/new')).text;
}

describe('upload validation', () => {
  it('rejects disallowed types (.html, .exe, .svg)', async () => {
    for (const [name, body] of [
      ['page.html', '<html><script>alert(1)</script></html>'],
      ['setup.exe', 'MZ\x90\x00binary'],
      ['logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
    ] as const) {
      await upload(Buffer.from(body), name).expect(303);
      expect(await errorShown(), name).toContain('This file type can&#39;t be uploaded.');
    }
    expect(listForCourse(ctx.db, 'os')).toHaveLength(0);
    expect(diskEntries()).toEqual([]);
  });

  it('rejects a file whose contents do not match its extension', async () => {
    await upload(Buffer.from('<html>not a pdf</html>'), 'fake.pdf').expect(303);
    expect(await errorShown()).toContain('contents don&#39;t match its .pdf name');
    await upload(PDF, 'notes.txt').expect(303);
    expect(await errorShown()).toContain('contents don&#39;t match its .txt name');
    expect(diskEntries()).toEqual([]);
  });

  it('rejects files over the size limit and writes nothing to disk', async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(1024 * 1024 + 10, 0x20)]);
    await upload(big, 'big.pdf').expect(303);
    expect(await errorShown()).toContain(
      'That file is over the 1 MB limit. Share it through a link instead.',
    );
    expect(listForCourse(ctx.db, 'os')).toHaveLength(0);
    expect(diskEntries()).toEqual([]);
  });

  it('accepts text formats such as a Python file', async () => {
    await upload(Buffer.from('print("bonjour")\n'), 'tp1.py').expect(303);
    const [m] = listForCourse(ctx.db, 'os');
    expect(m?.original_name).toBe('tp1.py');
    const res = await request(ctx.app).get(`/files/${m!.file_id}/tp1.py`).expect(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
  });
});

describe('file serving', () => {
  it('serves a PDF inline with the right headers', async () => {
    await upload(PDF, 'lecture.pdf').expect(303);
    const [m] = listForCourse(ctx.db, 'os');
    const res = await request(ctx.app).get(`/files/${m!.file_id}/lecture.pdf`).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toMatch(/^inline;/);
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
    expect(res.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(Buffer.from(res.body as Buffer).equals(PDF)).toBe(true);

    await request(ctx.app)
      .get(`/files/${m!.file_id}`)
      .set('If-None-Match', res.headers.etag as string)
      .expect(304);
  });

  it('round-trips an Arabic filename in Content-Disposition', async () => {
    const name = 'محاضرة ١ – Système.pdf';
    await agent
      .post('/admin/courses/os/materials')
      .field('_csrf', csrf)
      .field('title', 'Arabic name')
      .field('section', 'cours')
      .attach('file', PDF, { filename: name, contentType: 'application/pdf' })
      .expect(303);
    const [m] = listForCourse(ctx.db, 'os');
    expect(m?.original_name).toBe(name);
    const res = await request(ctx.app).get(`/files/${m!.file_id}`).expect(200);
    const header = res.headers['content-disposition'] as string;
    const encoded = /filename\*=UTF-8''([^;]+)/.exec(header)?.[1];
    expect(encoded && decodeURIComponent(encoded)).toBe(name);
    expect(header).toMatch(/filename="[\x20-\x7e]+"/);
  });

  it('serves scriptable types as octet-stream (defence in depth)', async () => {
    ctx.db
      .prepare(
        `INSERT INTO files (id, original_name, mime_type, size_bytes, sha256, created_at)
         VALUES ('evilfile01', 'x.html', 'text/html', 5, 'abc', '2026-01-01')`,
      )
      .run();
    fs.writeFileSync(`${ctx.config.uploadDir}/evilfile01`, '<b>x</b>');
    const res = await request(ctx.app).get('/files/evilfile01').expect(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('404s unknown ids, bad ids and files missing on disk', async () => {
    await request(ctx.app).get('/files/doesnotexist').expect(404);
    await request(ctx.app).get('/files/..%2F..%2Fetc%2Fpasswd').expect(404);
    ctx.db
      .prepare(
        `INSERT INTO files (id, original_name, mime_type, size_bytes, sha256, created_at)
         VALUES ('missing0001', 'gone.pdf', 'application/pdf', 5, 'abc', '2026-01-01')`,
      )
      .run();
    await request(ctx.app).get('/files/missing0001/gone.pdf').expect(404);
  });
});
