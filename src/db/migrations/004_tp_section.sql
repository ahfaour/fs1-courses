-- A separate "TP" section next to "Labs" (key 'tp2'; 'tp' stays the Labs section).
ALTER TABLE materials DROP CONSTRAINT materials_section_check;
ALTER TABLE materials ADD CONSTRAINT materials_section_check
  CHECK (section IN ('cours','td','tp','tp2','proj','exam','read','info'));
