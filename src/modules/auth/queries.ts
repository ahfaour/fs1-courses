import { nowIso, stmt, type DB } from '../../db/connection.js';

export interface Admin {
  id: number;
  email: string;
  password_hash: string;
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export function findAdminByEmail(db: DB, email: string): Admin | undefined {
  return stmt(db, 'SELECT id, email, password_hash FROM admins WHERE email = ?').get(
    normalizeEmail(email),
  ) as Admin | undefined;
}

/** Creates the admin, or replaces the password if the email already exists. */
export function upsertAdmin(db: DB, email: string, passwordHash: string): 'created' | 'updated' {
  const existing = findAdminByEmail(db, email);
  if (existing) {
    stmt(db, 'UPDATE admins SET password_hash = ? WHERE id = ?').run(passwordHash, existing.id);
    return 'updated';
  }
  stmt(db, 'INSERT INTO admins (email, password_hash, created_at) VALUES (?, ?, ?)').run(
    normalizeEmail(email),
    passwordHash,
    nowIso(),
  );
  return 'created';
}
