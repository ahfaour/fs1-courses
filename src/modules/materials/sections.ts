export const SECTIONS = [
  { key: 'cours', label: 'Lectures', fr: 'Cours' },
  { key: 'td', label: 'Tutorials', fr: 'TD' },
  { key: 'tp', label: 'Labs', fr: 'TP' },
  { key: 'proj', label: 'Projects', fr: '' },
  { key: 'exam', label: 'Exams & solutions', fr: '' },
  { key: 'read', label: 'Readings & links', fr: '' },
  { key: 'info', label: 'Program information', fr: '' },
] as const;

export type SectionKey = (typeof SECTIONS)[number]['key'];
export const SECTION_KEYS = SECTIONS.map((s) => s.key) as [SectionKey, ...SectionKey[]];

/** 'info' (Program information) is only offered for programs. */
export const sectionsFor = (kind: string) =>
  SECTIONS.filter((s) => s.key !== 'info' || kind === 'program');
