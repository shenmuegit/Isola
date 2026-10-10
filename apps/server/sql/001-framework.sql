CREATE TABLE IF NOT EXISTS plugins (
  name text PRIMARY KEY,
  publisher_id text NOT NULL REFERENCES "user"(id)
);

ALTER TABLE plugins ADD COLUMN IF NOT EXISTS backend_database text;
ALTER TABLE plugins ADD COLUMN IF NOT EXISTS backend_password text;

CREATE TABLE IF NOT EXISTS releases (
  id uuid PRIMARY KEY,
  plugin_name text NOT NULL REFERENCES plugins(name),
  version text NOT NULL,
  manifest jsonb NOT NULL,
  UNIQUE (plugin_name, version)
);

CREATE TABLE IF NOT EXISTS installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id),
  plugin_name text NOT NULL REFERENCES plugins(name),
  release_id uuid NOT NULL REFERENCES releases(id),
  UNIQUE (user_id, plugin_name)
);
