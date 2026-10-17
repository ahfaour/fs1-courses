import { nowIso, one, type Queryable } from '../../db/connection.js';

export interface Admin {
  id: number;
  email: string;
  password_hash: string;
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export function findAdminByEmail(db: Queryable, email: string): Promise<Admin | undefined> {
  return one<Admin>(db, 'SELECT id, email, password_hash FROM admins WHERE email = $1', [
    normalizeEmail(email),
  ]);
}

/** Creates the admin, or replaces the password if the email already exists. */
export async function upsertAdmin(
  db: Queryable,
  email: string,
  passwordHash: string,
): Promise<'created' | 'updated'> {
  const existing = await findAdminByEmail(db, email);
  if (existing) {
    await db.run('UPDATE admins SET password_hash = $1 WHERE id = $2', [passwordHash, existing.id]);
    return 'updated';
  }
  await db.run('INSERT INTO admins (email, password_hash, created_at) VALUES ($1, $2, $3)', [
    normalizeEmail(email),
    passwordHash,
    nowIso(),
  ]);
  return 'created';
}
