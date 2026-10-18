-- Hide a material from students for a while (Hide / Show buttons in the admin view).
ALTER TABLE materials ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT false;
