import type { schema } from '~/data/schema'

declare module 'on-zero' {
  interface Config {
    schema: typeof schema
    authData: null
    serverActions: {}
  }
}
