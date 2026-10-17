import 'express-session';

export interface Flash {
  type: 'ok' | 'error';
  message: string;
  values?: Record<string, string>;
}

declare module 'express-session' {
  interface SessionData {
    adminId?: number;
    adminEmail?: string;
    csrf?: string;
    flash?: Flash;
    returnTo?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      /** Set by the upload middleware when the file was refused before reaching disk. */
      uploadRejected?: 'type' | 'size';
    }
  }
}
