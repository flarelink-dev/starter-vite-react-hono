-- Notebook schema. Lives in the SAME D1 as Flarelink's auth tables
-- (user / account / verification) — that's the v0.2 SDK design: one
-- billing line, one binding, FKs work, joins work.
--
-- `user_id` REFERENCES "user"(id) ON DELETE CASCADE → deleting a user
-- through the Flarelink dashboard's Users panel sweeps their notes too,
-- no orphan rows. Same pattern Flarelink's own `account` table uses.

CREATE TABLE notes (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  attachment_key TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX notes_user_id_idx ON notes (user_id);
CREATE INDEX notes_user_created_idx ON notes (user_id, created_at DESC);
