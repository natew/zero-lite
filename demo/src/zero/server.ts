import { createZeroServer } from 'on-zero/server'

import { models } from '~/data/generated/models'
import { queries } from '~/data/generated/syncedQueries'
import { schema } from '~/data/schema'

const database =
  process.env.ZERO_UPSTREAM_DB ||
  'postgresql://user:password@127.0.0.1:6435/postgres'

export const zeroServer = createZeroServer({
  schema,
  models,
  queries,
  database,
})
