import session from 'express-session';
import { one, type DB } from '../../db/connection.js';

type Callback = (err?: unknown, data?: session.SessionData | null) => void;

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

/** express-session store backed by the app's database (table `sessions`). */
export class DbSessionStore extends session.Store {
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly db: DB) {
    super();
    this.timer = setInterval(() => void this.prune(), 15 * 60 * 1000);
    this.timer.unref();
  }

  private expiry(sess: session.SessionData): number {
    const exp = sess.cookie?.expires;
    return exp ? new Date(exp).getTime() : Date.now() + DEFAULT_TTL_MS;
  }

  override get(sid: string, cb: Callback): void {
    one<{ sess: string }>(this.db, 'SELECT sess FROM sessions WHERE sid = $1 AND expires_at > $2', [
      sid,
      Date.now(),
    ]).then(
      (row) => cb(null, row ? (JSON.parse(row.sess) as session.SessionData) : null),
      (err: unknown) => cb(err),
    );
  }

  override set(sid: string, sess: session.SessionData, cb?: (err?: unknown) => void): void {
    this.db
      .run(
        `INSERT INTO sessions (sid, sess, expires_at) VALUES ($1, $2, $3)
         ON CONFLICT (sid) DO UPDATE SET sess = excluded.sess, expires_at = excluded.expires_at`,
        [sid, JSON.stringify(sess), this.expiry(sess)],
      )
      .then(
        () => cb?.(),
        (err: unknown) => cb?.(err),
      );
  }

  override touch(sid: string, sess: session.SessionData, cb?: (err?: unknown) => void): void {
    this.db
      .run('UPDATE sessions SET expires_at = $1 WHERE sid = $2', [this.expiry(sess), sid])
      .then(
        () => cb?.(),
        (err: unknown) => cb?.(err),
      );
  }

  override destroy(sid: string, cb?: (err?: unknown) => void): void {
    this.db.run('DELETE FROM sessions WHERE sid = $1', [sid]).then(
      () => cb?.(),
      (err: unknown) => cb?.(err),
    );
  }

  async prune(): Promise<void> {
    try {
      await this.db.run('DELETE FROM sessions WHERE expires_at <= $1', [Date.now()]);
    } catch {
      // The database may already be closed during shutdown.
    }
  }

  close(): void {
    clearInterval(this.timer);
  }
}
