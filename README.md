# FS1 Computer Science Courses

One website where students find everything taught in the FS1 Computer Science courses (Lebanese
University, Faculty of Sciences, Section 1): lecture slides, tutorials (TD), labs (TP), projects,
past exams, readings and announcements, organised by course.

- **Students** need no account: browse courses, open or download materials, search, read announcements.
- **The instructor** signs in at `/admin/login` to add, edit and delete courses, materials and
  announcements, upload files and edit the profile. Saved changes are live immediately.

Server-rendered Express 4 + TypeScript app on Postgres. Pages work without JavaScript;
`public/js/enhance.js` only adds live search, form dialogs, copy-to-clipboard and two-click delete.

- **Database:** any Postgres via `DATABASE_URL` (Neon in production). Without it the app uses
  [PGlite](https://pglite.dev), an embedded Postgres stored in `data/pglite`, so nothing needs
  installing locally.
- **Uploaded files:** in the Postgres database (table `file_blobs`) when `DATABASE_URL` is set, so
  Render + Neon need nothing else (like UMS); otherwise the local `data/uploads` folder. An
  S3-compatible bucket can be used instead by setting `S3_BUCKET` (optional).

## Setup

Requires Node.js 20.12 or newer (Node 24 LTS recommended; Node 20 is past end of life).

```bash
cp .env.example .env          # then set SESSION_SECRET (see below)
npm ci
npm run create-admin -- --email you@example.com   # prompts for the password (12+ characters)
npm run dev                   # http://localhost:3000
```

On first start the app creates the tables and adds the five starter courses and the default profile
text. Then sign in at <http://localhost:3000/admin/login> and use **Edit name & contact** to fill in
your name, email and office hours (left empty on purpose).

Running `create-admin` again with the same email resets that admin's password. There are no default
credentials anywhere.

On Windows PowerShell, if `npm` is blocked by the script execution policy, use `npm.cmd` instead
(for example `npm.cmd run dev`).

### Scripts

| Script                    | What it does                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run dev`             | Start with auto-reload (tsx).                                                                    |
| `npm run build`           | Compile to `dist/`.                                                                              |
| `npm start`               | Run the compiled app (`node dist/src/server.js`).                                                |
| `npm test`                | Unit and HTTP integration tests (vitest + supertest, in-memory PGlite).                          |
| `npm run typecheck`       | TypeScript `--strict` check, tests included.                                                     |
| `npm run lint`            | ESLint and Prettier check. `npm run format` fixes formatting.                                    |
| `npm run migrate`         | Apply pending `src/db/migrations/*.sql` (also runs automatically at startup).                    |
| `npm run seed`            | Insert the profile row and starter courses if missing. Never overwrites edits.                   |
| `npm run create-admin`    | Create the admin or reset its password: `-- --email you@example.com`.                            |
| `npm run backup`          | Copy every table (JSON) and every uploaded file into `backups/fs1-<date>/`. Keeps the newest 14. |
| `npm run cleanup-orphans` | Delete stray stored files and unreferenced file rows older than 24 h. `-- --dry-run` to preview. |

Every script uses the same settings as the app, so with `DATABASE_URL` set it works on
the live site's data.

## Configuration

All settings come from environment variables (or `.env`, which is git-ignored).

| Variable               | Default           | Notes                                                                                                                                                                      |
| ---------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`             | `development`     | `production` turns on `Secure` cookies and requires a real `SESSION_SECRET`.                                                                                               |
| `PORT`                 | `3000`            |                                                                                                                                                                            |
| `SESSION_SECRET`       | dev-only fallback | **At least 32 characters in production**, or the app refuses to start. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. |
| `DATABASE_URL`         | empty             | Postgres connection string, e.g. Neon's `postgresql://…?sslmode=require`. Empty = PGlite in `PGLITE_DIR`.                                                                  |
| `PGLITE_DIR`           | `./data/pglite`   | Embedded database folder, used only without `DATABASE_URL`.                                                                                                                |
| `S3_BUCKET`            | empty             | Optional bucket for uploads. Empty = the database (with `DATABASE_URL`) or `UPLOAD_DIR`.                                                                                   |
| `S3_ENDPOINT`          | empty             | R2: `https://<account-id>.r2.cloudflarestorage.com`. B2: `https://s3.<region>.backblazeb2.com`. Empty for AWS S3.                                                          |
| `S3_REGION`            | `auto`            | `auto` for R2; the bucket's region for B2 and AWS.                                                                                                                         |
| `S3_ACCESS_KEY_ID`     |                   | Required with `S3_BUCKET`.                                                                                                                                                 |
| `S3_SECRET_ACCESS_KEY` |                   | Required with `S3_BUCKET`.                                                                                                                                                 |
| `S3_PREFIX`            | `uploads/`        | Key prefix inside the bucket.                                                                                                                                              |
| `UPLOAD_DIR`           | `./data/uploads`  | Local uploads folder, used only without `DATABASE_URL` and `S3_BUCKET`.                                                                                                    |
| `MAX_UPLOAD_MB`        | `50`              | Larger files are refused with a message suggesting a link instead.                                                                                                         |
| `TRUST_PROXY`          | `0`               | Number of reverse proxies in front of the app: `1` behind nginx/Caddy, `3` on Render. Needed for `Secure` cookies and the login rate limit.                                |

On Render (where the `RENDER` variable is set) the app refuses to start without `DATABASE_URL`,
because the local disk is wiped on every restart and data would be lost silently.

## Project layout

```
src/
  server.ts, app.ts, config.ts, deps.ts
  db/            connection (pg / PGlite), migrate, seed, migrations/001_init.sql
  modules/       courses, materials, announcements, profile, files, auth
                 (each: routes.ts = HTTP, queries.ts = SQL, schema.ts = zod validation)
                 files/storage.ts = local folder, dbStorage.ts = Postgres, s3Storage.ts = bucket
  views/         Nunjucks templates (auto-escaped); admin forms under views/admin
public/          css/site.css, js/enhance.js
scripts/         seed, create-admin, backup, cleanup-orphans
test/            vitest + supertest
render.yaml      Render Blueprint
```

## Security notes

- Admin passwords are hashed with argon2id. Login is rate-limited to 5 failed attempts per IP per
  15 minutes, with one generic error for unknown email and wrong password.
- Sessions live in the database; cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production; the
  session id is regenerated on login; idle timeout is 8 hours.
- Every admin POST checks a per-session CSRF token (403 on mismatch). One `requireAdmin` middleware
  guards the whole `/admin` router except the login page.
- Templates auto-escape everything; descriptions and announcements are plain text with line breaks
  kept. No Markdown or HTML rendering.
- Strict CSP (`script-src 'self'`, no inline scripts or styles) via helmet.
- Uploads: extension allow-list **and** content sniffing (`file-type`); stored under random ids and
  never publicly addressable; the app streams files through `/files/:id` with `nosniff`, `inline` only
  for PDF and images, and an RFC 5987 filename so Arabic and French names survive. External links
  must be `http(s)://`.

## Deploying on Render (free)

The free plan sleeps after 15 minutes without visitors (the next visit takes about a minute) and
has no persistent disk, so everything, uploaded files included, lives in a Neon Postgres
database, the same setup as UMS.

1. **Database: Neon.** At <https://neon.tech> create a project (region: Frankfurt / `eu-central-1`).
   Copy the connection string (`postgresql://…?sslmode=require`).
2. **Render.** At <https://dashboard.render.com> → **New → Blueprint** → connect this GitHub
   repository. Render reads `render.yaml` and asks only for `DATABASE_URL`. `SESSION_SECRET` is
   generated by Render. The first deploy creates the tables and the starter courses.
3. **First admin.** Render's free plan has no shell, so run this on your own computer against the
   Neon database (PowerShell):

   ```powershell
   $env:DATABASE_URL = "postgresql://…?sslmode=require"
   npm.cmd run create-admin -- --email you@example.com
   Remove-Item Env:DATABASE_URL
   ```

4. Open `https://<service>.onrender.com/admin/login`, sign in and fill in your profile. A custom
   domain can be added later under the service's **Settings → Custom Domains**.

Every push to `main` redeploys automatically.

**Space.** Neon's free plan has limited storage (about 0.5 GB per project at the time of writing;
check Neon's pricing page). Files count against it, so `render.yaml` caps uploads at 20 MB. Share
large files (videos, big datasets) as Google Drive or GitHub links instead. If space runs out, the app can use an S3-compatible bucket instead (the `S3_*` variables), but the files already uploaded must be copied into it first.

### Other hosts and Docker

Behind your own reverse proxy with HTTPS, set `NODE_ENV=production`, a strong `SESSION_SECRET` and
`TRUST_PROXY=1`. Without HTTPS the browser will not send the `Secure` session cookie and sign-in
will not stick.

```bash
docker build -t fs1-courses .
docker volume create fs1-data
docker run -d --name fs1 -p 3000:3000 -v fs1-data:/app/data \
  -e SESSION_SECRET="$(openssl rand -base64 36)" -e TRUST_PROXY=1 fs1-courses
docker exec -it fs1 node dist/scripts/create-admin.js --email you@example.com
```

Without `DATABASE_URL` the container keeps its database and uploads in the
`/app/data` volume.

## Backups

`npm run backup` writes `backups/fs1-<date>/db.json` (every table) and `files/` (every upload),
keeping the newest 14. Run it on your computer with the live `DATABASE_URL` set
to back up the production site. Neon also keeps a short restore history of its own.

Run `npm run cleanup-orphans` now and then to remove files left behind by failed deletes.

## Known limitations (v1)

- **Last write wins.** Two tabs editing the same material overwrite each other; fine for one admin.
- **Session expiry mid-edit** sends you to the login page and back to the page you were on; what you
  had typed in the form may be lost.
- **Oversize uploads**: the form comes back with the size message; fields placed after the file
  input (the link) are not kept.
- Search is a simple case-insensitive `ILIKE` on titles, notes and course names; accents count
  (`é` ≠ `e`).
- Course URLs (slugs) are made from the name when the course is created and do not change on rename,
  so shared links keep working.
- No student accounts, drafts, scheduled release, email notifications or UI translation (out of
  scope for v1).

## Open questions for the owner

- Custom domain name.
- Should exams and solutions stay hidden until a release date? (Would add a nullable `visible_from`
  column to `materials`.)
- Should students need a course password or university login to see materials?
- Real course codes, levels and semesters for each course (edit them in the app).
