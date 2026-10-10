CREATE TABLE IF NOT EXISTS notes (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  title text NOT NULL,
  body text NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_user_id ON notes (user_id);
