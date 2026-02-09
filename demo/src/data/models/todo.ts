import { boolean, number, string, table } from '@rocicorp/zero'
import { mutations, serverWhere } from 'on-zero'

export const schema = table('todo')
  .columns({
    id: string(),
    text: string(),
    completed: boolean(),
    createdAt: number(),
  })
  .primaryKey('id')

const permissions = serverWhere('todo', () => {
  return true
})

export const mutate = mutations(schema, permissions)
