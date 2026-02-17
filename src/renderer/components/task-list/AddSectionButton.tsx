import { useState, useRef, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { useCreateProject } from '@/hooks/use-task-mutations'

interface AddSectionButtonProps {
  parentProjectId: number
}

export function AddSectionButton({ parentProjectId }: AddSectionButtonProps) {
  const [isAdding, setIsAdding] = useState(false)
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const createProject = useCreateProject()

  useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isAdding])

  const handleSubmit = () => {
    const trimmed = name.trim()
    if (trimmed) {
      createProject.mutate(
        { title: trimmed, parent_project_id: parentProjectId },
        {
          onSuccess: () => {
            setName('')
            setIsAdding(false)
          },
        }
      )
    } else {
      setIsAdding(false)
      setName('')
    }
  }

  if (isAdding) {
    return (
      <div className="flex h-9 items-center gap-2 px-4 pt-4 pb-1">
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit()
            if (e.key === 'Escape') {
              setIsAdding(false)
              setName('')
            }
          }}
          onBlur={handleSubmit}
          placeholder="Section name"
          className="flex-1 bg-transparent text-[13px] font-bold text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none"
        />
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setIsAdding(true)}
      className="flex h-9 items-center gap-1.5 px-4 pt-4 pb-1 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
    >
      <Plus className="h-3.5 w-3.5" />
      <span className="text-[12px]">Add Section</span>
    </button>
  )
}
