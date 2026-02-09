import { defineQuery, defineQueries } from '@rocicorp/zero'
import * as v from 'valibot'

import * as Queries from './groupedQueries'

const todo = {
  allTodos: defineQuery(
    v.object({
      limit: v.optional(v.number()),
    }),
    ({ args }) => Queries.todo.allTodos(args)
  ),
  todoById: defineQuery(
    v.object({
      todoId: v.string(),
    }),
    ({ args }) => Queries.todo.todoById(args)
  ),
}

export const queries = defineQueries({
  todo,
})
