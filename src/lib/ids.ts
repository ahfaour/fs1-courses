import crypto from 'node:crypto';

/** Random URL-safe id, e.g. for materials, files and announcements. */
export const randomId = (bytes = 9): string => crypto.randomBytes(bytes).toString('base64url');

export const FILE_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
export const COURSE_ID_RE = /^[a-z0-9-]{1,64}$/;

/**
 * Course slug from a name: accents stripped, lower-case, dashes. Names with no Latin letters or
 * digits (e.g. Arabic only) fall back to a random id. `taken` makes it unique with -2, -3…
 */
export function slugify(name: string, taken: (slug: string) => boolean = () => false): string {
  let base = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  if (!base) base = crypto.randomBytes(5).toString('hex');
  let slug = base;
  for (let n = 2; taken(slug); n++) slug = `${base}-${n}`;
  return slug;
}
