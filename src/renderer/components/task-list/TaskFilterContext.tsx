import { createContext, useContext } from 'react'

interface TaskFilterContextValue {
  filterMyTasks: boolean
  currentUserId: number | undefined
}

export const TaskFilterContext = createContext<TaskFilterContextValue>({
  filterMyTasks: false,
  currentUserId: undefined,
})

export function useTaskFilter() {
  return useContext(TaskFilterContext)
}
