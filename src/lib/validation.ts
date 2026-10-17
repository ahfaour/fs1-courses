import { z } from 'zod';
import { isHttpUrl } from './format.js';

const asString = (v: unknown) => (typeof v === 'string' ? v : '');

/** Optional text field from a form: trimmed, '' when absent. */
export const text = (max: number, label: string) =>
  z.preprocess(asString, z.string().trim().max(max, `${label} can be at most ${max} characters.`));

/** Required text field. */
export const requiredText = (max: number, label: string, emptyMessage: string) =>
  z.preprocess(
    asString,
    z.string().trim().min(1, emptyMessage).max(max, `${label} can be at most ${max} characters.`),
  );

/** 'YYYY-MM-DD' or null when empty. */
export const optionalDate = z.preprocess(
  (v) => asString(v).trim() || null,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-17.')
    .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'That date does not exist.')
    .nullable(),
);

/** http(s) URL or null when empty. javascript:, data: and everything else are rejected. */
export const optionalHttpUrl = z.preprocess(
  (v) => asString(v).trim() || null,
  z
    .string()
    .max(2000, 'Links can be at most 2000 characters.')
    .refine(isHttpUrl, 'Links must start with http:// or https://')
    .nullable(),
);

/** First validation message, for a flash. */
export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Check the form and try again.';
}

/** The submitted string fields, to re-fill a form after a validation error. */
export function formValues(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (body && typeof body === 'object') {
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === 'string' && k !== '_csrf' && k !== 'password') out[k] = v.slice(0, 5000);
    }
  }
  return out;
}
