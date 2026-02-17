import { useState, useRef } from 'react'
import { useSubtasks } from '@/hooks/use-subtasks'
import { useCreateSubtask, useCompleteTask } from '@/hooks/use-task-mutations'
import { cn } from '@/lib/cn'
import type { Task } from '@/lib/vikunja-types'

interface SubtaskListProps {
  parentTask: Task
}

export function SubtaskList({ parentTask }: SubtaskListProps) {
  const { data: subtasks, isLoading } = useSubtasks(parentTask.id)
  const createSubtask = useCreateSubtask()
  const completeTask = useCompleteTask()
  const [newTitle, setNewTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = () => {
    const trimmed = newTitle.trim()
    if (!trimmed) return
    createSubtask.mutate(
      { parentTask, title: trimmed },
      { onSuccess: () => setNewTitle('') }
    )
  }

  if (isLoading) {
    return <div className="py-1 text-2xs text-[var(--text-secondary)]">Loading subtasks...</div>
  }

  return (
    <div className="mt-2">
      {subtasks && subtasks.length > 0 && (
        <div className="mb-1 flex flex-col gap-0.5">
          {subtasks.map((st) => (
            <div key={st.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!st.done) completeTask.mutate(st)
                }}
                className={cn(
                  'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors',
                  st.done
                    ? 'border-[var(--text-secondary)] bg-[var(--text-secondary)]'
                    : 'border-[var(--border-color)] hover:border-[var(--accent-blue)]'
                )}
              >
                {st.done && (
                  <svg className="h-2 w-2 text-white" viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
              <span
                className={cn(
                  'text-xs text-[var(--text-primary)]',
                  st.done && 'text-[var(--text-secondary)] line-through'
                )}
              >
                {st.title}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="h-3.5 w-3.5 shrink-0 rounded border border-dashed border-[var(--border-color)]" />
        <input
          ref={inputRef}
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleSubmit()
            }
            if (e.key === 'Escape') {
              setNewTitle('')
              inputRef.current?.blur()
            }
          }}
          placeholder="Add subtask..."
          className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none"
        />
      </div>
    </div>
  )
}
