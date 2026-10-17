import session from 'express-session';
import { stmt, type DB } from '../../db/connection.js';

type Callback = (err?: unknown, data?: session.SessionData | null) => void;

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

/** express-session store backed by the app's SQLite database (table `sessions`). */
export class SqliteSessionStore extends session.Store {
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly db: DB) {
    super();
    this.timer = setInterval(() => this.prune(), 15 * 60 * 1000);
    this.timer.unref();
  }

  private expiry(sess: session.SessionData): number {
    const exp = sess.cookie?.expires;
    return exp ? new Date(exp).getTime() : Date.now() + DEFAULT_TTL_MS;
  }

  override get(sid: string, cb: Callback): void {
    try {
      const row = stmt(this.db, 'SELECT sess, expires_at FROM sessions WHERE sid = ?').get(sid) as
        { sess: string; expires_at: number } | undefined;
      if (!row || row.expires_at <= Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.sess) as session.SessionData);
    } catch (err) {
      cb(err);
    }
  }

  override set(sid: string, sess: session.SessionData, cb?: (err?: unknown) => void): void {
    try {
      stmt(
        this.db,
        `INSERT INTO sessions (sid, sess, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires_at = excluded.expires_at`,
      ).run(sid, JSON.stringify(sess), this.expiry(sess));
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }

  override touch(sid: string, sess: session.SessionData, cb?: (err?: unknown) => void): void {
    try {
      stmt(this.db, 'UPDATE sessions SET expires_at = ? WHERE sid = ?').run(this.expiry(sess), sid);
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }

  override destroy(sid: string, cb?: (err?: unknown) => void): void {
    try {
      stmt(this.db, 'DELETE FROM sessions WHERE sid = ?').run(sid);
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }

  prune(): void {
    try {
      stmt(this.db, 'DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    } catch {
      // The database may already be closed during shutdown.
    }
  }

  close(): void {
    clearInterval(this.timer);
  }
}
