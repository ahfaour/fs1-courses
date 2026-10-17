import { z } from 'zod';
import { optionalDate, requiredText } from '../../lib/validation.js';

export const AnnouncementSchema = z.object({
  body: requiredText(1000, 'Announcement', 'Write the announcement first.'),
  course_id: z.preprocess((v) => (typeof v === 'string' && v ? v : null), z.string().nullable()),
  posted_on: optionalDate,
});
