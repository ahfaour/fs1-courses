import { insertCourse, type CourseInput } from '../modules/courses/queries.js';
import { nowIso, type DB } from './connection.js';

// From the reference prototype. The topic lists are a placeholder outline, not the official syllabus.
const COURSES: (CourseInput & { id: string })[] = [
  {
    id: 'ml',
    name: 'Machine Learning',
    code: '',
    level: '',
    semester: '',
    kind: 'course',
    description:
      'Foundations of learning from data: building, training and evaluating predictive models.',
    topics: [
      'Supervised learning',
      'Regression',
      'Classification',
      'Model evaluation',
      'Clustering',
      'Neural networks',
    ],
    color_index: 0,
    sort_order: 0,
  },
  {
    id: 'os',
    name: 'Operating Systems',
    code: '',
    level: '',
    semester: '',
    kind: 'course',
    description:
      'How an operating system manages processes, memory and storage, and how programs interact with it.',
    topics: [
      'Processes & threads',
      'CPU scheduling',
      'Synchronization',
      'Deadlocks',
      'Memory management',
      'File systems',
    ],
    color_index: 1,
    sort_order: 1,
  },
  {
    id: 'rdb',
    name: 'Relational Databases',
    code: '',
    level: '',
    semester: '',
    kind: 'course',
    description: 'Designing, querying and maintaining relational databases.',
    topics: [
      'Relational model',
      'Relational algebra',
      'SQL',
      'ER modelling',
      'Normalization',
      'Transactions',
    ],
    color_index: 2,
    sort_order: 2,
  },
  {
    id: 'nlp',
    name: 'Natural Language Processing',
    code: '',
    level: '',
    semester: '',
    kind: 'course',
    description:
      'Methods for representing, analysing and generating human language with computers.',
    topics: [
      'Text preprocessing',
      'Language models',
      'Word embeddings',
      'Sequence labelling',
      'Transformers',
    ],
    color_index: 3,
    sort_order: 3,
  },
  {
    id: 'geoai',
    name: 'GeoAI Professional Master 2',
    code: 'M2 Pro',
    level: 'M2',
    semester: '',
    kind: 'program',
    description:
      'Professional Master 2 bringing together geospatial data and artificial intelligence. Program information, schedules and course materials for M2 GeoAI students.',
    topics: [],
    color_index: 4,
    sort_order: 4,
  },
];

const PROFILE = {
  title: 'Instructor of Computer Science · Coordinator, Professional Master 2 in GeoAI',
  affiliation: 'Lebanese University · Faculty of Sciences, Section 1',
  intro:
    'Course materials for my students: lecture slides, tutorials (TD), labs (TP), projects and past exams, organised by course. Pick a course on the left, or search everything below.',
};

/** Idempotent: inserts the profile row and the five courses only if they are missing. */
export function seed(db: DB): { courses: number; profile: boolean } {
  return db.transaction(() => {
    const profile =
      db
        .prepare(
          `INSERT OR IGNORE INTO profile (id, name, title, affiliation, intro, email, office_hours, updated_at)
           VALUES (1, '', @title, @affiliation, @intro, '', '', @now)`,
        )
        .run({ ...PROFILE, now: nowIso() }).changes > 0;
    let courses = 0;
    for (const { id, ...c } of COURSES) {
      const before = db.prepare('SELECT 1 FROM courses WHERE id = ?').get(id);
      insertCourse(db, id, c, true);
      if (!before) courses++;
    }
    return { courses, profile };
  })();
}
