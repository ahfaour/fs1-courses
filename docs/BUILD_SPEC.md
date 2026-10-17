# FS1 Computer Science Courses — Build Specification

A brief for a coding agent. It describes what to build, how it should be built, and how to know it is done. Read the whole file before writing code.

---

## 1. Context

**Owner:** a Computer Science instructor at the Lebanese University, Faculty of Sciences, Section 1 (FS1). He teaches Machine Learning, Operating Systems, Relational Databases, NLP and other courses, and coordinates the **GeoAI Professional Master 2 (M2 Pro)**.

**Purpose:** one website where his students find everything he teaches: lecture slides, tutorials (TD), labs (TP), projects, past exams, readings, and announcements, organised by course.

**Users and roles**

| Role | Who | Can do |
|---|---|---|
| Visitor (student) | Anyone with the link. No account. | Browse courses, open or download materials, search, read announcements. |
| Admin (instructor) | The owner only (one account to start) | Everything a visitor can do, plus create, edit and delete courses, materials and announcements, upload files, and edit his profile. |

There are no student accounts in v1. Do not build sign-up.

**Reference implementation:** `fs1-courses-reference.html` (attached next to this file) is a working single-file prototype. It shows the intended layout, visual design, wording and behaviour. It was built for a hosted sandbox, so its persistence code (`claude.use("artifact")`, `claude.use("assets")`, `artifact.publish(...)`) **must not be copied**. Replace that layer with the real backend described below. Reuse its CSS and markup structure freely.

---

## 2. Scope

### In scope (v1)
1. Public overview page: instructor header, welcome text, search box, announcements, grid of course cards.
2. Public course page: course header (code, level, semester, description, topics), then materials grouped by section.
3. Search across all material titles, notes and course names.
4. Admin login and logout.
5. Admin CRUD for profile, courses, materials and announcements.
6. File upload for materials, plus external links (Google Drive, GitHub, Moodle, YouTube).
7. Light and dark theme that follows the OS setting.
8. Responsive layout down to 360 px wide.

### Out of scope (v1). Do not build these.
- Student accounts, grades, submissions, comments or forums.
- Multiple instructors or fine-grained permissions.
- Arabic/French UI translation. Keep content fields Unicode-safe so Arabic or French titles display correctly, but the UI chrome is English.
- Email notifications.

---

## 3. Recommended stack

A small server-rendered app with a single SQLite database. This keeps hosting cheap, backups trivial (one `.db` file plus one uploads folder) and avoids building a separate API and SPA for a site with one editor.

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js 20 LTS, TypeScript (strict) | Common, easy to host. |
| Web framework | Express 4 | Minimal and well known. |
| Views | Server-rendered templates (EJS or Nunjucks) | Pages work without JavaScript and load fast on slow connections. |
| Database | SQLite via `better-sqlite3` | One file, synchronous, no DB server to run. |
| Migrations | Plain numbered `.sql` files run at startup, tracked in a `schema_migrations` table | No ORM needed at this size. |
| Validation | `zod` | One schema per form. |
| Password hashing | `argon2` (argon2id) | Current recommended algorithm. |
| Sessions | `express-session` with a SQLite store | Cookie session for the single admin. |
| CSRF | Synchronizer token stored in the session, checked on every state-changing request | Required because auth is cookie-based. |
| Uploads | `multer` writing to disk under `UPLOAD_DIR` | Simple. Abstract behind a small `storage` module so S3 can be added later. |
| Security headers | `helmet` with an explicit CSP | See §8. |
| Tests | `vitest` + `supertest` | Unit and HTTP integration tests. |
| Lint/format | ESLint + Prettier | Keep the existing config if one is present. |

If the agent's environment strongly favours another stack (for example Python + FastAPI + Jinja), that is acceptable as long as the architecture, data model, routes, security rules and acceptance criteria below are kept. **Do not** switch to a heavier stack (microservices, a separate SPA, an external database server) without a written reason.

### Alternative for a zero-backend setup
If the owner prefers free static hosting (GitHub Pages or Netlify) and is comfortable editing a JSON file in Git, the same UI can be generated from `content/site.json` with materials stored in the repo or linked from Google Drive. The UI and data model in this spec still apply. Only §5 (admin) and §6 (uploads) go away. Build the server version unless told otherwise.

---

## 4. Data model

All IDs are short URL-safe strings (slugs for courses, random IDs for everything else). Timestamps are ISO-8601 UTC text.

```sql
CREATE TABLE profile (
  id            INTEGER PRIMARY KEY CHECK (id = 1),   -- single row
  name          TEXT NOT NULL DEFAULT '',
  title         TEXT NOT NULL DEFAULT '',
  affiliation   TEXT NOT NULL DEFAULT '',
  intro         TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  office_hours  TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL
);

CREATE TABLE courses (
  id            TEXT PRIMARY KEY,                     -- slug, e.g. 'os', 'geoai'
  name          TEXT NOT NULL,
  code          TEXT NOT NULL DEFAULT '',
  level         TEXT NOT NULL DEFAULT '',             -- 'L3', 'M1', 'M2'…
  semester      TEXT NOT NULL DEFAULT '',             -- 'Fall 2026–27'
  kind          TEXT NOT NULL CHECK (kind IN ('course','program')),
  description   TEXT NOT NULL DEFAULT '',
  topics_json   TEXT NOT NULL DEFAULT '[]',           -- JSON array of strings
  color_index   INTEGER NOT NULL DEFAULT 0 CHECK (color_index BETWEEN 0 AND 5),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE materials (
  id            TEXT PRIMARY KEY,
  course_id     TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  section       TEXT NOT NULL CHECK (section IN ('cours','td','tp','proj','exam','read','info')),
  title         TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  material_date TEXT,                                 -- 'YYYY-MM-DD', shown to students
  url           TEXT,                                 -- external link, OR NULL when a file is stored
  file_id       TEXT REFERENCES files(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  CHECK ((url IS NOT NULL) <> (file_id IS NOT NULL))  -- exactly one source
);
CREATE INDEX idx_materials_course ON materials(course_id, section, material_date DESC);

CREATE TABLE files (
  id            TEXT PRIMARY KEY,                     -- random; also the on-disk name
  original_name TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE announcements (
  id            TEXT PRIMARY KEY,
  course_id     TEXT REFERENCES courses(id) ON DELETE CASCADE,  -- NULL = general
  body          TEXT NOT NULL,
  posted_on     TEXT NOT NULL,                        -- 'YYYY-MM-DD'
  created_at    TEXT NOT NULL
);

CREATE TABLE admins (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
```

**Rules**
- Turn on `PRAGMA foreign_keys = ON` and `PRAGMA journal_mode = WAL` at connection time.
- Wrap multi-row changes (deleting a course and its files, replacing a material's file) in a transaction.
- Deleting a course cascades to its materials and announcements. Deleting a material whose file is not referenced elsewhere also deletes the file from disk, **after** the DB transaction commits. If the disk delete fails, log it and leave an orphan rather than failing the request. A cleanup script (§10) removes orphans.

**Sections.** Display labels, in this order:

| key | Label | French tag |
|---|---|---|
| `cours` | Lectures | Cours |
| `td` | Tutorials | TD |
| `tp` | Labs | TP |
| `proj` | Projects | — |
| `exam` | Exams & solutions | — |
| `read` | Readings & links | — |
| `info` | Program information (programs only) | — |

**Seed data** (`npm run seed`, idempotent). Copy descriptions and topics from the `state` JSON block in the reference HTML:

| id | name | kind | color |
|---|---|---|---|
| `ml` | Machine Learning | course | 0 |
| `os` | Operating Systems | course | 1 |
| `rdb` | Relational Databases | course | 2 |
| `nlp` | Natural Language Processing | course | 3 |
| `geoai` | GeoAI Professional Master 2 | program (code `M2 Pro`, level `M2`) | 4 |

Leave profile name and email empty; the owner fills them in. The topic lists are a placeholder outline, not the official syllabus.

---

## 5. Routes

### Public (no auth)

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Overview: header, intro, search, announcements (newest first), course cards (courses first, then programs, each by `sort_order`). |
| GET | `/courses/:id` | Course page. 404 page if the id is unknown. Empty sections are hidden. If the course has no materials, show "Materials for this course will be posted here." |
| GET | `/search?q=` | Results list: course name, date, title, type badge, Open button. Case-insensitive `LIKE` match on title, note and course name is enough. Escape `%` and `_` in the input. Cap `q` at 100 chars. |
| GET | `/files/:id/:filename?` | Streams an uploaded file (§6). |
| GET | `/healthz` | Returns `200 ok` after a trivial DB query. |

### Admin (session required, CSRF on every POST)

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/admin/login` | Login form. Rate-limited (§8). |
| POST | `/admin/logout` | Destroys the session. |
| GET | `/admin` | Dashboard: same layout as public pages, with edit controls visible. |
| POST | `/admin/profile` | Update profile. |
| POST | `/admin/courses` | Create course. Slug generated from the name, made unique. |
| POST | `/admin/courses/:id` | Update course. |
| POST | `/admin/courses/:id/delete` | Delete course (cascades). |
| POST | `/admin/courses/:id/materials` | Create material (multipart: optional file, or URL). |
| POST | `/admin/materials/:id` | Update material. A new file replaces the old one. |
| POST | `/admin/materials/:id/delete` | Delete material. |
| POST | `/admin/announcements` | Create announcement. |
| POST | `/admin/announcements/:id/delete` | Delete announcement. |

Use POST with `/delete` suffixes rather than DELETE so plain HTML forms work without JavaScript. Every admin POST redirects back (Post/Redirect/Get) with a one-time flash message such as "Material added." or a validation error.

**Admin UI approach.** Render the public templates with an `isAdmin` flag. When true, show the dark edit bar, "+ Add" buttons per section, and Edit/Delete per row, as in the reference. Forms can open in a `<dialog>` element when JS is on and fall back to a separate page when it is off. Deletes need a confirmation step (the reference uses a two-click "Confirm delete" button). Do not use `window.confirm`.

There is no draft/publish step in this version: an admin save is live immediately. The reference had one only because of its hosting model.

---

## 6. File uploads

- **Allowed types** (check both extension and detected MIME type, using `file-type` on the first bytes): `pdf, pptx, ppt, docx, doc, xlsx, xls, csv, txt, md, ipynb, zip, png, jpg, jpeg, gif, sql, py, java, c, cpp, h`.
- **Max size:** `MAX_UPLOAD_MB` (default 50). Reject larger files with a clear message: "That file is over the 50 MB limit. Share it through a link instead."
- **Storage:** save as `UPLOAD_DIR/<random-id>` with **no** user-controlled path component. Record the original name, size, MIME type and sha256 in `files`.
- **Serving** `GET /files/:id/:filename?`:
  - Look up the id, 404 if missing. Never build a filesystem path from request input other than the validated id.
  - `Content-Type`: stored MIME type. For any type that a browser could run as HTML or script (`html`, `svg`, `xml`, `js`), serve as `application/octet-stream` instead. These types are not on the allow-list anyway; this is defence in depth.
  - `Content-Disposition`: `inline` for PDF and images, `attachment` for everything else, with an RFC 5987-encoded `filename*` so Arabic and French names survive.
  - `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=86400`, and an `ETag` from the sha256.
- **External links:** accept only `http://` and `https://` URLs. Reject `javascript:`, `data:` and anything else. Render with `target="_blank" rel="noopener noreferrer"`.
- **Type badge** next to each material: the file extension upper-cased (`PDF`, `PPTX`, `IPYNB`), or `LINK` for external URLs.

---

## 7. Front-end and design

Keep the visual identity of the reference page. Copy its CSS custom properties, layout and components rather than inventing a new look.

**Layout.** Header band with affiliation label, instructor name (large display type), title line, and contact (email shown as selectable text with a Copy button, office hours). Below it, a two-column layout: a sticky course index on the left (240 px) and the content on the right. Under 820 px the index becomes a horizontally scrolling row of chips above the content.

**Fonts** (Google Fonts, always with system fallbacks): Schibsted Grotesk (display headings), IBM Plex Sans (body), IBM Plex Mono (labels, dates, codes).

**Colour tokens** (define every colour as a CSS variable, light values on `:root`, dark values under `@media (prefers-color-scheme: dark)`):

| Token | Light | Dark |
|---|---|---|
| `--paper` (page bg) | `#F1F3F6` | `#0F141B` |
| `--surface` | `#FFFFFF` | `#161D27` |
| `--ink` | `#151C27` | `#E5E9EF` |
| `--muted` | `#586273` | `#98A2B1` |
| `--line` | `#D8DDE5` | `#29323F` |
| `--accent` | `#0E6B57` | `#4DC2A2` |
| `--warn` | `#A33A2A` | `#F0846F` |
| `--c0`…`--c5` course colours | `#B4532A #2D69A0 #86680F #963A6B #0E6B57 #5B5FB0` | `#E58A62 #79AEE0 #D6B455 #DC85B4 #4DC2A2 #A3A7F0` |

Each course's `color_index` selects one of `--c0`…`--c5`. It colours the card's top border, the index dot, the course code and the search-result course label.

**Rules**
- Dates display as `17 Oct 2026` (`en-GB` style) with tabular numerals.
- Pages must work with JavaScript disabled. JS only enhances: live search filtering, dialogs, copy-to-clipboard, two-click delete.
- Accessibility: visible `:focus-visible` outlines, `aria-current="page"` on the active index link, labelled form controls, colour never the only signal, `prefers-reduced-motion` respected, WCAG AA contrast in both themes.
- No horizontal page scroll at 360 px.

**Copy.** Plain and direct, written for students. Examples to reuse from the reference: "Find slides, labs, exams…", "No announcements right now.", "Nothing matches “…”.", "Materials for this course will be posted here."

---

## 8. Security requirements

These are not optional.

1. **Admin authentication.** Passwords hashed with argon2id. The first admin is created with a CLI command (`npm run create-admin -- --email you@example.com`) that prompts for the password. Never create one from env vars or seed data. No default credentials anywhere.
2. **Sessions.** Cookie flags `HttpOnly`, `Secure` (in production), `SameSite=Lax`. Regenerate the session id on login. Idle timeout 8 h. `SESSION_SECRET` from the environment; refuse to start in production if it is missing or shorter than 32 chars.
3. **CSRF.** A per-session token in every admin form, validated on every POST. Reject with 403 on mismatch.
4. **Authorization.** A single `requireAdmin` middleware mounted on the `/admin` router (except `/admin/login`). Do not scatter auth checks inside handlers.
5. **Login rate limiting.** At most 5 failed attempts per IP per 15 minutes, then 429. Use the same generic error for unknown email and wrong password.
6. **Output escaping.** Templates auto-escape all user content. Never use the raw/unescaped output tag for user data. Announcement and description text render as plain text with line breaks preserved (`white-space: pre-line`). No Markdown or HTML rendering in v1.
7. **Input validation.** Zod schemas with max lengths: name 120, code 40, title 200, note 500, description 2000, announcement 1000, each topic 80 (max 30 topics), URL 2000.
8. **SQL.** Prepared statements only. No string-built SQL.
9. **Headers.** `helmet` with a CSP of `default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; frame-ancestors 'none'`. Keep all JS in static files (no inline scripts) so `script-src 'self'` holds.
10. **Secrets and logs.** Secrets only from environment variables, with a committed `.env.example` and `.env` in `.gitignore`. Never log passwords, session ids or CSRF tokens.
11. **Uploads.** See §6. Uploaded files are never executed or rendered as HTML.

---

## 9. Configuration

`.env.example`:

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_PATH=./data/site.db
UPLOAD_DIR=./data/uploads
MAX_UPLOAD_MB=50
SESSION_SECRET=change-me-to-a-long-random-string
TRUST_PROXY=false        # set true behind nginx/Caddy so Secure cookies and rate limits see the real IP
```

---

## 10. Project structure

```
fs1-courses/
├─ src/
│  ├─ server.ts            # creates the app, starts listening
│  ├─ app.ts               # express setup, middleware, routers (exported for tests)
│  ├─ config.ts            # reads and validates env vars
│  ├─ db/
│  │  ├─ connection.ts
│  │  ├─ migrate.ts
│  │  └─ migrations/001_init.sql
│  ├─ modules/
│  │  ├─ courses/          # routes.ts, queries.ts, schema.ts
│  │  ├─ materials/
│  │  ├─ announcements/
│  │  ├─ profile/
│  │  ├─ files/            # storage.ts (disk), routes.ts (serving)
│  │  └─ auth/             # login, logout, requireAdmin, csrf
│  └─ views/               # layout + pages + partials
├─ public/                 # css/site.css, js/enhance.js
├─ scripts/                # seed.ts, create-admin.ts, cleanup-orphans.ts, backup.sh
├─ test/
├─ .env.example
└─ README.md
```

Keep SQL in each module's `queries.ts`, HTTP handling in `routes.ts`, and validation in `schema.ts`. Do not add a generic repository layer, service layer or DI container. They would add indirection without solving a problem at this size.

**Scripts** (`package.json`): `dev`, `build`, `start`, `test`, `lint`, `migrate`, `seed`, `create-admin`, `cleanup-orphans` (deletes files on disk with no `files` row, and `files` rows no material references, older than 24 h).

---

## 11. Testing

Test behaviour through HTTP where possible.

**Integration (supertest against an in-memory or temp-file SQLite DB)**
- `/` lists seeded courses and shows "No announcements right now." when empty.
- `/courses/os` renders; `/courses/does-not-exist` returns 404.
- Search finds a material by a word in its note; `%` in the query is treated literally.
- Every `/admin/*` route except login redirects to login when signed out.
- An admin POST without a valid CSRF token returns 403.
- Login: wrong password shows the generic error; the 6th failed attempt in 15 min returns 429.
- Creating a material with neither file nor URL fails validation; with both, the file wins and the URL is ignored (or reject; pick one and test it).
- A `javascript:` URL is rejected.
- Uploading a disallowed type (e.g. `.html`, `.exe`) is rejected; a PDF is accepted and served with `Content-Type: application/pdf`, `nosniff` and `inline`.
- A file with an Arabic filename round-trips in `Content-Disposition`.
- Deleting a course removes its materials and announcements.
- Stored content containing `<script>` renders escaped.

**Unit**
- Slug generation (accents, Arabic-only names fall back to a random id, uniqueness suffix).
- Date formatting.
- Type-badge derivation.

**Manual checklist before handing over**
- Light and dark themes, at 360 px, 820 px and 1280 px wide.
- Keyboard-only navigation through the index, search, and an admin form.
- With JavaScript disabled: browse, search, and add a material as admin.

---

## 12. Failure cases to handle

| Situation | Expected behaviour |
|---|---|
| Upload exceeds size limit | Form re-shows with the size message; nothing written to disk. |
| Disk full or write error during upload | 500 page with "Upload failed. Try again, or share a link instead."; no `materials` row created. |
| DB write fails after file saved | Delete the just-saved file, show the error. |
| Two browser tabs editing the same material | Last write wins. Acceptable for a single admin; note it in the README. |
| Double-submit of a create form | Disable the submit button on submit (JS); PRG redirect prevents refresh resubmits. |
| Session expired mid-edit | Redirect to login, then back to the page that was being edited. Form contents may be lost; acceptable for v1. |
| Missing uploaded file on disk | `/files/:id` returns 404 and logs a warning. |

---

## 13. Deployment and backup

- Run behind a reverse proxy (Caddy or nginx) with HTTPS. Set `TRUST_PROXY=true`.
- Persist `data/` (database and uploads) on a volume.
- `scripts/backup.sh`: `sqlite3 site.db ".backup ..."` (safe while running) plus a tarball of `uploads/`, dated, keeping the last 14. Document a cron line in the README.
- Provide a `Dockerfile` (Node 20 slim, non-root user, `data/` as a volume) and document `docker run`.

---

## 14. Milestones

Deliver in this order. Each step should leave the app runnable with passing tests.

1. **Skeleton:** config, DB connection, migrations, seed, `/healthz`, layout template with the design tokens.
2. **Public read pages:** overview, course page, search, 404.
3. **Auth:** `create-admin`, login/logout, sessions, CSRF, rate limit, `requireAdmin`.
4. **Admin CRUD:** profile, courses, announcements, materials with links.
5. **Uploads:** storage module, upload validation, file serving, delete handling, orphan cleanup.
6. **Polish:** progressive JS (live search, dialogs, copy, two-click delete), accessibility pass, responsive pass.
7. **Ops:** Dockerfile, backup script, README.

## 15. Definition of done

- All of §11 passes; `npm run lint` is clean; TypeScript has no errors under `strict`.
- Fresh clone → `cp .env.example .env` → `npm ci && npm run migrate && npm run seed && npm run create-admin && npm run dev` works, as documented in the README.
- A signed-out visitor cannot change anything; an admin can add a PDF to Operating Systems → Labs and a student sees it on `/courses/os` immediately.
- The README explains setup, configuration, backups, and the known limitations from §12.

## 16. Ask before deciding

Stop and ask the owner rather than guessing about:
- The domain name and where it will be hosted.
- Whether exams and solutions should be hidden until a release date (a likely v2 feature: add a nullable `visible_from` column to `materials`).
- Whether students should need a course password or university login to see materials.
- The real course codes, levels and semesters for each course.
