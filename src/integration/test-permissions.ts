import type { PGlite } from '@electric-sql/pglite'

type DbLike = Pick<PGlite, 'query' | 'exec'>

const ALLOW_ALL_CONDITION = { type: 'and', conditions: [] as unknown[] }
const ALLOW_ALL_POLICY = [['allow', ALLOW_ALL_CONDITION]]
const DEFAULT_APP_ID = process.env.ZERO_APP_ID?.trim() || 'zero'

export async function installAllowAllPermissions(
  db: DbLike,
  tables: string[]
): Promise<void> {
  const schemas = await findPermissionsSchemas(db)
  if (schemas.length === 0) {
    schemas.push(DEFAULT_APP_ID)
  }

  for (const schema of schemas) {
    const quotedSchema = '"' + schema.replace(/"/g, '""') + '"'

    // Bootstrap the same global permissions table shape zero-cache expects.
    await db.exec(`
    CREATE SCHEMA IF NOT EXISTS ${quotedSchema};

    CREATE TABLE IF NOT EXISTS ${quotedSchema}.permissions (
      "permissions" JSONB,
      "hash"        TEXT,
      "lock" BOOL PRIMARY KEY DEFAULT true CHECK (lock)
    );

    CREATE OR REPLACE FUNCTION ${quotedSchema}.set_permissions_hash()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.hash = md5(NEW.permissions::text);
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS on_set_permissions ON ${quotedSchema}.permissions;
    CREATE TRIGGER on_set_permissions
      BEFORE INSERT OR UPDATE ON ${quotedSchema}.permissions
      FOR EACH ROW
      EXECUTE FUNCTION ${quotedSchema}.set_permissions_hash();

    INSERT INTO ${quotedSchema}.permissions ("permissions")
      VALUES (NULL)
      ON CONFLICT DO NOTHING;
  `)

    const existing = await db.query<{ permissions: unknown }>(
      `SELECT permissions FROM ${quotedSchema}.permissions WHERE lock = true LIMIT 1`
    )
    const existingPermissions = parsePermissions(existing.rows[0]?.permissions)

    const tablesToAdd = Object.fromEntries(
      tables.map((table) => [
        table,
        {
          row: {
            select: ALLOW_ALL_POLICY,
            insert: ALLOW_ALL_POLICY,
            update: {
              preMutation: ALLOW_ALL_POLICY,
              postMutation: ALLOW_ALL_POLICY,
            },
            delete: ALLOW_ALL_POLICY,
          },
        },
      ])
    )

    const permissions = {
      ...existingPermissions,
      tables: {
        ...(existingPermissions.tables || {}),
        ...tablesToAdd,
      },
    }

    await db.query(
      `UPDATE ${quotedSchema}.permissions SET permissions = $1 WHERE lock = true`,
      [JSON.stringify(permissions)]
    )
  }
}

function parsePermissions(value: unknown): { tables?: Record<string, unknown> } {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return {}
    }
  }
  if (typeof value === 'object') return value as { tables?: Record<string, unknown> }
  return {}
}

async function findPermissionsSchemas(db: DbLike): Promise<string[]> {
  const result = await db.query<{ schemaname: string }>(
    `SELECT schemaname
     FROM pg_tables
     WHERE tablename = 'permissions'
       AND schemaname NOT IN ('pg_catalog', 'information_schema')
       AND schemaname NOT LIKE 'pg_%'
     ORDER BY CASE WHEN schemaname = $1 THEN 0 ELSE 1 END, schemaname`,
    [DEFAULT_APP_ID]
  )
  return result.rows.map((r) => r.schemaname)
}
