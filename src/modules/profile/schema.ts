import { z } from 'zod';
import { text } from '../../lib/validation.js';

export const ProfileSchema = z.object({
  name: text(120, 'Name'),
  title: text(200, 'Title line'),
  affiliation: text(200, 'Affiliation'),
  intro: text(2000, 'Welcome text'),
  email: text(200, 'Email').refine(
    (v) => v === '' || z.string().email().safeParse(v).success,
    'Enter a valid email address, or leave it empty.',
  ),
  office_hours: text(200, 'Office hours'),
});
