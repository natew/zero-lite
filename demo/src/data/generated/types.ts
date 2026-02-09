import type { TableInsertRow, TableUpdateRow } from 'on-zero'
import * as tables from './tables'

export type Todo = TableInsertRow<typeof tables.todo>
export type TodoUpdate = TableUpdateRow<typeof tables.todo>
