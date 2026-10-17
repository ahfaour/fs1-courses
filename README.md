# FS1 Computer Science Courses

One website where students find everything taught in the FS1 Computer Science courses (Lebanese
University, Faculty of Sciences, Section 1): lecture slides, tutorials (TD), labs (TP), projects,
past exams, readings and announcements, organised by course.

- **Students** need no account: browse courses, open or download materials, search, read announcements.
- **The instructor** signs in at `/admin/login` to add, edit and delete courses, materials and
  announcements, upload files and edit the profile. Saved changes are live immediately.

Server-rendered Express 4 + TypeScript app with a single SQLite file and an uploads folder. Pages
work without JavaScript; `public/js/enhance.js` only adds live search, form dialogs, copy-to-clipboard
and two-click delete.

## Setup

Requires Node.js 20.12 or newer (Node 24 LTS recommended; Node 20 is past end of life).

```bash
cp .env.example .env          # then set SESSION_SECRET (see below)
npm ci
npm run migrate               # creates data/site.db
npm run seed                  # adds the five courses and the default profile text (safe to re-run)
npm run create-admin -- --email you@example.com   # prompts for the password (12+ characters)
npm run dev                   # http://localhost:3000
```

Then sign in at <http://localhost:3000/admin/login> and use **Edit name & contact** to fill in your
name, email and office hours (left empty by the seed on purpose).

Running `create-admin` again with the same email resets that admin's password. There are no default
credentials anywhere.

### Scripts

| Script                    | What it does                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run dev`             | Start with auto-reload (tsx).                                                                          |
| `npm run build`           | Compile to `dist/`.                                                                                    |
| `npm start`               | Run the compiled app (`node dist/src/server.js`).                                                      |
| `npm test`                | Unit and HTTP integration tests (vitest + supertest).                                                  |
| `npm run typecheck`       | TypeScript `--strict` check, tests included.                                                           |
| `npm run lint`            | ESLint and Prettier check. `npm run format` fixes formatting.                                          |
| `npm run migrate`         | Apply pending `src/db/migrations/*.sql` (also runs automatically at startup).                          |
| `npm run seed`            | Insert the profile row and seed courses if missing. Never overwrites edits.                            |
| `npm run create-admin`    | Create the admin or reset its password: `-- --email you@example.com`.                                  |
| `npm run cleanup-orphans` | Delete stray uploaded files and unreferenced file rows older than 24 h. Add `-- --dry-run` to preview. |

## Configuration

All settings come from environment variables (or `.env`, which is git-ignored).

| Variable         | Default           | Notes                                                                                                                                                                      |
| ---------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`       | `development`     | `production` turns on `Secure` cookies and requires a real `SESSION_SECRET`.                                                                                               |
| `PORT`           | `3000`            |                                                                                                                                                                            |
| `DATABASE_PATH`  | `./data/site.db`  | SQLite file (WAL mode).                                                                                                                                                    |
| `UPLOAD_DIR`     | `./data/uploads`  | Uploaded files, stored under random ids.                                                                                                                                   |
| `MAX_UPLOAD_MB`  | `50`              | Larger files are refused with a message suggesting a link instead.                                                                                                         |
| `SESSION_SECRET` | dev-only fallback | **At least 32 characters in production**, or the app refuses to start. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. |
| `TRUST_PROXY`    | `false`           | Set `true` behind nginx/Caddy so `Secure` cookies and the login rate limit see the real client.                                                                            |

## Project layout

```
src/
  server.ts, app.ts, config.ts, deps.ts
  db/            connection, migrate, seed, migrations/001_init.sql
  modules/       courses, materials, announcements, profile, files, auth
                 (each: routes.ts = HTTP, queries.ts = SQL, schema.ts = zod validation)
  views/         Nunjucks templates (auto-escaped); admin forms under views/admin
public/          css/site.css, js/enhance.js
scripts/         seed, create-admin, cleanup-orphans, backup.sh
test/            vitest + supertest
```

## Security notes

- Admin passwords are hashed with argon2id. Login is rate-limited to 5 failed attempts per IP per
  15 minutes, with one generic error for unknown email and wrong password.
- Sessions live in SQLite; cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production; the session
  id is regenerated on login; idle timeout is 8 hours.
- Every admin POST checks a per-session CSRF token (403 on mismatch). One `requireAdmin` middleware
  guards the whole `/admin` router except the login page.
- Templates auto-escape everything; descriptions and announcements are plain text with line breaks
  kept. No Markdown or HTML rendering.
- Strict CSP (`script-src 'self'`, no inline scripts or styles) via helmet.
- Uploads: extension allow-list **and** content sniffing (`file-type`); stored as
  `UPLOAD_DIR/<random-id>`; served with `nosniff`, `inline` only for PDF and images, and an RFC 5987
  filename so Arabic and French names survive. External links must be `http(s)://`.

## Deployment

Run behind a reverse proxy with HTTPS and set `NODE_ENV=production`, a strong `SESSION_SECRET` and
`TRUST_PROXY=true`. Without HTTPS the browser will not send the `Secure` session cookie and sign-in
will not stick.

Example Caddyfile:

```
courses.example.edu {
  reverse_proxy localhost:3000
}
```

### Docker

```bash
docker build -t fs1-courses .
docker volume create fs1-data
docker run -d --name fs1 -p 3000:3000 -v fs1-data:/app/data \
  -e SESSION_SECRET="$(openssl rand -base64 36)" -e TRUST_PROXY=true fs1-courses
docker exec fs1 node dist/scripts/seed.js
docker exec -it fs1 node dist/scripts/create-admin.js --email you@example.com
```

Migrations run automatically when the container starts. Everything that must survive is in the
`/app/data` volume (database + uploads).

## Backups

`scripts/backup.sh [DATA_DIR] [BACKUP_DIR]` writes a dated copy of the database using SQLite's online
`.backup` (safe while the app is running) and a tarball of `uploads/`, keeping the newest 14 of each.
It needs the `sqlite3` CLI. Nightly cron example:

```
30 2 * * * cd /srv/fs1-courses && scripts/backup.sh ./data /var/backups/fs1 >> /var/log/fs1-backup.log 2>&1
```

To restore: stop the app, copy a `site-*.db` back to `data/site.db`, extract the matching
`uploads-*.tar.gz` into `data/`, start the app.

Run `npm run cleanup-orphans` from cron weekly to remove files left behind by failed deletes.

## Known limitations (v1)

- **Last write wins.** Two tabs editing the same material overwrite each other; fine for one admin.
- **Session expiry mid-edit** sends you to the login page and back to the page you were on; what you
  had typed in the form may be lost.
- **Oversize uploads**: the form comes back with the size message; fields placed after the file
  input (the link) are not kept.
- Search is a simple case-insensitive `LIKE` on titles, notes and course names. Case folding only
  covers ASCII, so `é` and `É` are different letters to it.
- Course URLs (slugs) are made from the name when the course is created and do not change on rename,
  so shared links keep working.
- No student accounts, drafts, scheduled release, email notifications or UI translation (out of
  scope for v1).

## Open questions for the owner

- Domain name and hosting.
- Should exams and solutions stay hidden until a release date? (Would add a nullable `visible_from`
  column to `materials`.)
- Should students need a course password or university login to see materials?
- Real course codes, levels and semesters for each course (edit them in the app).
