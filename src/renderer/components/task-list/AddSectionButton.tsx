import { useState, useRef, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { useCreateProject, useReorderProject } from '@/hooks/use-task-mutations'
import { planInsertedSibling } from '@/lib/reorder-positions'
import type { Project } from '@/lib/vikunja-types'

interface AddSectionButtonProps {
  parentProjectId: number
  /** The sections at this level, in display order. */
  siblings: readonly Project[]
  /** Where the new section goes: the number of sections above this spot. */
  index: number
}

/**
 * A strip between two sections (or after the last) that shows "Add section" on hover or keyboard
 * focus and turns into a name field. The section is created last by the server, then moved into
 * the gap when the gap is not at the end. The project menu in the sidebar adds one at the end too.
 */
export function AddSectionButton({ parentProjectId, siblings, index }: AddSectionButtonProps) {
  const [isAdding, setIsAdding] = useState(false)
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const createProject = useCreateProject()
  const reorderProject = useReorderProject()

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
          onSuccess: (created) => {
            const plan = planInsertedSibling(siblings, created, index)
            if (plan) reorderProject.mutate({ id: created.id, position: plan.position, renumbered: plan.renumbered })
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
      <div className="flex h-9 items-center gap-2 px-6">
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
          aria-label="Section name"
          className="flex-1 bg-transparent text-section text-text placeholder:text-text-secondary focus:outline-none"
        />
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setIsAdding(true)}
      className="group/section flex h-6 w-full items-center gap-2 px-6 text-meta text-text-secondary opacity-0 transition-opacity duration-fade-fast hover:opacity-100 focus-visible:opacity-100"
      aria-label="Add section"
    >
      <span className="h-px flex-1 bg-border" />
      <span className="flex shrink-0 items-center gap-1">
        <Plus className="h-3 w-3" />
        Add section
      </span>
      <span className="h-px flex-1 bg-border" />
    </button>
  )
}
