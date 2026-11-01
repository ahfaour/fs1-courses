import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pglite, type DB } from '../src/db/connection.js';
import { copyDatabase } from '../src/db/copy.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { upsertAdmin } from '../src/modules/auth/queries.js';
import { insertFile } from '../src/modules/files/queries.js';
import { insertMaterial, listForCourse } from '../src/modules/materials/queries.js';

// Two separate in-memory databases, standing in for Neon (source) and Aiven (target).
let source: DB;
let target: DB;
beforeEach(async () => {
  [source, target] = await Promise.all([pglite('memory'), pglite('memory')]);
  await migrate(source);
  await seed(source);
});
afterEach(async () => {
  await Promise.all([source.close(), target.close()]);
});

const BYTES = Buffer.from('%PDF-1.4 lecture notes \x00\x01\x02\xff', 'binary');

async function addUploadedMaterial(db: DB) {
  await insertFile(db, {
    id: 'file123',
    original_name: 'notes.pdf',
    mime_type: 'application/pdf',
    size_bytes: BYTES.length,
    sha256: 'x',
  });
  await db.run('INSERT INTO file_blobs (id, data, created_at) VALUES ($1, $2, $3)', [
    'file123',
    BYTES,
    '2026-10-01T00:00:00.000Z',
  ]);
  await insertMaterial(db, 'mat1', 'os', {
    section: 'cours',
    title: 'Week 1',
    note: '',
    material_date: '2026-10-01',
    url: null,
    file_id: 'file123',
    hidden: false,
  });
}

describe('copyDatabase', () => {
  it('copies content, uploaded file bytes and admins into an empty database', async () => {
    await addUploadedMaterial(source);
    await upsertAdmin(source, 'a@example.com', 'hash-a');
    await upsertAdmin(source, 'b@example.com', 'hash-b');

    const counts = await copyDatabase(source, target);

    expect(counts.file_blobs).toBe(1);
    expect(counts.admins).toBe(2);
    const [m] = await listForCourse(target, 'os', { includeHidden: true });
    expect(m).toMatchObject({ title: 'Week 1', file_id: 'file123', original_name: 'notes.pdf' });
    const [blob] = await target.query<{ data: Uint8Array }>('SELECT data FROM file_blobs');
    expect(Buffer.compare(Buffer.from(blob!.data), BYTES)).toBe(0);
  });

  it('continues admin ids after the copied ones', async () => {
    await upsertAdmin(source, 'a@example.com', 'hash-a');
    await upsertAdmin(source, 'b@example.com', 'hash-b');
    await copyDatabase(source, target);

    await upsertAdmin(target, 'c@example.com', 'hash-c');
    const ids = await target.query<{ id: number }>('SELECT id FROM admins ORDER BY id');
    expect(ids.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('refuses to overwrite a database that already has content', async () => {
    await migrate(target);
    await seed(target);
    await expect(copyDatabase(source, target)).rejects.toThrow(/not empty/);
  });

  it('refuses when the two schemas differ', async () => {
    await source.run('DELETE FROM schema_migrations WHERE name = $1', ['005_material_hidden.sql']);
    await expect(copyDatabase(source, target)).rejects.toThrow(/Schemas differ/);
  });

  it('copies nothing if a row fails part way through', async () => {
    await addUploadedMaterial(source);
    // A material pointing at a course that does not exist makes the copy fail mid-way.
    await source.exec('ALTER TABLE materials DROP CONSTRAINT materials_course_id_fkey');
    await source.run("UPDATE materials SET course_id = 'gone' WHERE id = 'mat1'");

    await expect(copyDatabase(source, target)).rejects.toThrow();
    const left = await target.query<{ n: number }>('SELECT count(*)::int AS n FROM courses');
    expect(left[0]!.n).toBe(0);
  });
});
