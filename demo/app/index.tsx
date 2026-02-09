import { useState, memo } from 'react'
import { useQuery, zero } from '~/zero/client'
import { allTodos } from '~/data/queries/todo'
import type { Todo } from '~/data/generated/types'

export default memo(function HomePage() {
  const [todos, { type }] = useQuery(allTodos, {})
  const [text, setText] = useState('')
  const isLoading = type === 'unknown'

  const addTodo = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    zero.mutate.todo.insert({
      id: crypto.randomUUID(),
      text: trimmed,
      completed: false,
      createdAt: Date.now(),
    })
    setText('')
  }

  const toggleTodo = (todo: Todo) => {
    zero.mutate.todo.update({ id: todo.id, completed: !todo.completed })
  }

  const deleteTodo = (id: string) => {
    zero.mutate.todo.delete({ id })
  }

  return (
    <div data-testid="app-container" style={styles.container}>
      <h1 style={styles.title}>zerolite demo</h1>

      <div style={styles.form} data-testid="todo-form">
        <input
          data-testid="todo-input"
          style={styles.input}
          type="text"
          placeholder="What needs to be done?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTodo()}
        />
        <button data-testid="todo-add" style={styles.button} onClick={addTodo}>
          Add
        </button>
      </div>

      {isLoading ? (
        <div data-testid="loading">loading...</div>
      ) : todos.length === 0 ? (
        <div data-testid="empty-state" style={styles.empty}>
          no todos yet
        </div>
      ) : (
        <ul data-testid="todo-list" style={styles.list}>
          {todos.map((todo) => (
            <li
              key={todo.id}
              data-testid={`todo-item-${todo.id}`}
              style={styles.item}
            >
              <input
                data-testid={`todo-checkbox-${todo.id}`}
                type="checkbox"
                checked={todo.completed}
                onChange={() => toggleTodo(todo)}
                style={styles.checkbox}
              />
              <span
                data-testid={`todo-text-${todo.id}`}
                style={{
                  ...styles.text,
                  textDecoration: todo.completed ? 'line-through' : 'none',
                  opacity: todo.completed ? 0.6 : 1,
                }}
              >
                {todo.text}
              </span>
              <button
                data-testid={`todo-delete-${todo.id}`}
                style={styles.deleteButton}
                onClick={() => deleteTodo(todo.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div data-testid="todo-count" style={styles.count}>
        {todos.length} todo{todos.length !== 1 ? 's' : ''}
      </div>
    </div>
  )
})

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 600,
    margin: '40px auto',
    padding: '0 20px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  title: {
    fontSize: 28,
    fontWeight: 600,
    marginBottom: 24,
  },
  form: {
    display: 'flex',
    gap: 8,
    marginBottom: 24,
  },
  input: {
    flex: 1,
    padding: '10px 14px',
    fontSize: 16,
    border: '1px solid #ccc',
    borderRadius: 6,
    outline: 'none',
  },
  button: {
    padding: '10px 20px',
    fontSize: 16,
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },
  list: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 0',
    borderBottom: '1px solid #eee',
  },
  checkbox: {
    width: 20,
    height: 20,
    cursor: 'pointer',
  },
  text: {
    flex: 1,
    fontSize: 16,
  },
  deleteButton: {
    padding: '4px 10px',
    fontSize: 14,
    backgroundColor: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
  },
  empty: {
    color: '#888',
    textAlign: 'center' as const,
    padding: '40px 0',
    fontSize: 16,
  },
  count: {
    color: '#888',
    fontSize: 14,
    marginTop: 16,
    textAlign: 'center' as const,
  },
}
