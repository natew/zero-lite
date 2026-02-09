import { createZeroClient } from 'on-zero'

import { models } from '~/data/generated/models'
import { schema } from '~/data/schema'
import * as groupedQueries from '~/data/generated/groupedQueries'

import type { ReactNode } from 'react'

const ZERO_SERVER_URL =
  import.meta.env.VITE_PUBLIC_ZERO_SERVER || 'http://localhost:4849'

export const {
  useQuery,
  zero,
  ProvideZero: ProvideZeroInner,
} = createZeroClient({
  models,
  schema,
  groupedQueries,
})

export const ProvideZero = ({ children }: { children: ReactNode }) => {
  return (
    <ProvideZeroInner
      userID="demo"
      auth=""
      kvStore="idb"
      authData={null}
      cacheURL={ZERO_SERVER_URL}
    >
      {children}
    </ProvideZeroInner>
  )
}
