const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' (or a full ISO timestamp) → '17 Oct 2026'. Anything unparseable → ''. */
export function formatDate(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!m) return '';
  const [, y, mo, d] = m;
  const month = MONTHS[Number(mo) - 1];
  if (!month || Number(d) < 1 || Number(d) > 31) return '';
  return `${Number(d)} ${month} ${y}`;
}

export const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** Type badge: the uploaded file's extension upper-cased, or LINK for an external URL. */
export function typeBadge(m: { file_id?: string | null; original_name?: string | null }): string {
  if (!m.file_id) return 'LINK';
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(m.original_name ?? '')?.[1];
  return ext ? ext.toUpperCase() : 'FILE';
}

/** Only http(s) URLs are ever rendered as links. */
export function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
