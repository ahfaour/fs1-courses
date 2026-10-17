import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { formatDate, isHttpUrl, typeBadge } from '../src/lib/format.js';
import { slugify } from '../src/lib/ids.js';
import { contentDisposition } from '../src/modules/files/routes.js';
import { escapeLike } from '../src/modules/materials/queries.js';

describe('slugify', () => {
  it('lower-cases, strips accents and joins words with dashes', () => {
    expect(slugify('Machine Learning')).toBe('machine-learning');
    expect(slugify('  Systèmes d’exploitation (L3) ')).toBe('systemes-d-exploitation-l3');
    expect(slugify('Bases de données — Avancé')).toBe('bases-de-donnees-avance');
  });

  it('falls back to a random id for names with no Latin letters', () => {
    const a = slugify('معالجة اللغات الطبيعية');
    const b = slugify('معالجة اللغات الطبيعية');
    expect(a).toMatch(/^[a-f0-9]{10}$/);
    expect(a).not.toBe(b);
  });

  it('adds a numeric suffix until the slug is unique', () => {
    const taken = new Set(['os', 'os-2']);
    expect(slugify('OS', (s) => taken.has(s))).toBe('os-3');
  });

  it('caps the length at 40 without a trailing dash', () => {
    const s = slugify('a'.repeat(39) + ' bcd');
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith('-')).toBe(false);
  });
});

describe('formatDate', () => {
  it('formats like en-GB short dates', () => {
    expect(formatDate('2026-10-17')).toBe('17 Oct 2026');
    expect(formatDate('2026-09-03')).toBe('3 Sep 2026');
    expect(formatDate('2026-10-17T08:00:00.000Z')).toBe('17 Oct 2026');
  });
  it('returns empty for missing or invalid input', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate('')).toBe('');
    expect(formatDate('17/10/2026')).toBe('');
    expect(formatDate('2026-13-01')).toBe('');
  });
});

describe('typeBadge', () => {
  it('uses the upper-cased extension for files', () => {
    expect(typeBadge({ file_id: 'f', original_name: 'Chapitre 1.pdf' })).toBe('PDF');
    expect(typeBadge({ file_id: 'f', original_name: 'slides.PPTX' })).toBe('PPTX');
    expect(typeBadge({ file_id: 'f', original_name: 'tp.ipynb' })).toBe('IPYNB');
    expect(typeBadge({ file_id: 'f', original_name: 'README' })).toBe('FILE');
  });
  it('says LINK for external URLs', () => {
    expect(typeBadge({ file_id: null, original_name: null })).toBe('LINK');
  });
});

describe('helpers', () => {
  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
  it('accepts only http(s) URLs', () => {
    expect(isHttpUrl('https://drive.google.com/x')).toBe(true);
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('data:text/html,x')).toBe(false);
    expect(isHttpUrl('/relative')).toBe(false);
  });
  it('builds an RFC 5987 Content-Disposition', () => {
    expect(contentDisposition('inline', 'a.pdf')).toBe(
      `inline; filename="a.pdf"; filename*=UTF-8''a.pdf`,
    );
    expect(contentDisposition('attachment', 'é "x".pdf')).toBe(
      `attachment; filename="_ _x_.pdf"; filename*=UTF-8''%C3%A9%20%22x%22.pdf`,
    );
  });
});

describe('config', () => {
  it('refuses to start in production without a long SESSION_SECRET', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'short' })).toThrow();
    expect(loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32) }).env).toBe(
      'production',
    );
  });
  it('parses TRUST_PROXY and MAX_UPLOAD_MB', () => {
    const c = loadConfig({ TRUST_PROXY: 'true', MAX_UPLOAD_MB: '20' });
    expect(c.trustProxy).toBe(true);
    expect(c.maxUploadMb).toBe(20);
  });
});
