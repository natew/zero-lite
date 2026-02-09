CREATE TABLE IF NOT EXISTS "todo" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "text" TEXT NOT NULL,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "created_at" BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)
);
