import { serverWhere, zql } from 'on-zero'

const permission = serverWhere('todo', () => {
  return true
})

export const allTodos = (props: { limit?: number }) => {
  return zql.todo
    .where(permission)
    .orderBy('createdAt', 'desc')
    .limit(props.limit ?? 100)
}

export const todoById = (props: { todoId: string }) => {
  return zql.todo.where(permission).where('id', props.todoId).one()
}
