import { z } from 'zod';
import { optionalDate, optionalHttpUrl, requiredText, text } from '../../lib/validation.js';
import { SECTION_KEYS } from './sections.js';

export const MaterialSchema = z.object({
  title: requiredText(200, 'Title', 'Add a title so students know what this is.'),
  section: z.enum(SECTION_KEYS, { message: 'Choose a section.' }),
  material_date: optionalDate,
  note: text(500, 'Note'),
  url: optionalHttpUrl,
  // Checkbox: present ('1') when ticked, absent otherwise.
  hidden: z.unknown().transform((v) => v === '1'),
});
