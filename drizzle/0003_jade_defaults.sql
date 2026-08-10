-- Jade palette: align stored column defaults with the application schema.
-- Changing the Drizzle declaration alone does not touch defaults already
-- stored in PostgreSQL, so inserts omitting color would keep producing the
-- old indigo on existing databases. Additive: existing rows are untouched.
ALTER TABLE tracks ALTER COLUMN color SET DEFAULT '#00a878';
ALTER TABLE tags ALTER COLUMN color SET DEFAULT '#00a878';
