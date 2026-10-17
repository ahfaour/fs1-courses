import { nowIso, stmt, type DB } from '../../db/connection.js';

export interface Profile {
  name: string;
  title: string;
  affiliation: string;
  intro: string;
  email: string;
  office_hours: string;
  updated_at: string;
}

const EMPTY: Profile = {
  name: '',
  title: '',
  affiliation: '',
  intro: '',
  email: '',
  office_hours: '',
  updated_at: '',
};

export function getProfile(db: DB): Profile {
  const row = stmt(
    db,
    'SELECT name, title, affiliation, intro, email, office_hours, updated_at FROM profile WHERE id = 1',
  ).get() as Profile | undefined;
  return row ?? EMPTY;
}

export function saveProfile(db: DB, p: Omit<Profile, 'updated_at'>): void {
  stmt(
    db,
    `INSERT INTO profile (id, name, title, affiliation, intro, email, office_hours, updated_at)
     VALUES (1, @name, @title, @affiliation, @intro, @email, @office_hours, @updated_at)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, title = excluded.title,
       affiliation = excluded.affiliation, intro = excluded.intro, email = excluded.email,
       office_hours = excluded.office_hours, updated_at = excluded.updated_at`,
  ).run({ ...p, updated_at: nowIso() });
}
