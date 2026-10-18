-- Manual order of materials within a course section (↑ / ↓ buttons in the admin view).
ALTER TABLE materials ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

-- Keep the order the site showed until now: newest date first, undated last.
UPDATE materials m
SET position = r.n
FROM (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY course_id, section
           ORDER BY material_date DESC NULLS LAST, created_at DESC
         ) - 1 AS n
  FROM materials
) r
WHERE m.id = r.id;

DROP INDEX idx_materials_course;
CREATE INDEX idx_materials_course ON materials(course_id, section, position);
