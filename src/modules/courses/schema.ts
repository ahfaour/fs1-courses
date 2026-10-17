import { z } from 'zod';
import { requiredText, text } from '../../lib/validation.js';

export const COLORS = ['Rust', 'Blue', 'Ochre', 'Plum', 'Green', 'Indigo'] as const;

export const CourseSchema = z.object({
  name: requiredText(120, 'Name', 'Give the course a name.'),
  code: text(40, 'Course code'),
  level: text(40, 'Level'),
  semester: text(40, 'Semester'),
  kind: z.enum(['course', 'program'], { message: 'Choose Course or Program.' }),
  description: text(2000, 'Description'),
  topics: z.preprocess(
    (v) =>
      (typeof v === 'string' ? v : '')
        .split(/\r?\n/)
        .map((t) => t.trim())
        .filter(Boolean),
    z
      .array(z.string().max(80, 'Each topic can be at most 80 characters.'))
      .max(30, 'List at most 30 topics.'),
  ),
  color_index: z.coerce.number().int().min(0).max(5).catch(0),
  sort_order: z.coerce.number().int().min(-9999).max(9999).catch(0),
});

export type CourseForm = z.infer<typeof CourseSchema>;
