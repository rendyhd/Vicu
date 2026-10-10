import { useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import type { Project } from '@/lib/vikunja-types'
import { ProjectMenu } from './ProjectMenu'

/** The … button next to a project page's title: the same menu as in the sidebar. */
export function ProjectHeaderMenu({ project }: { project: Project }) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${project.title} actions`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 w-7 items-center justify-center rounded-control text-[var(--text-secondary)] transition-colors duration-fade-fast hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      >
        <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
      </button>
      {open && (
        <ProjectMenu
          project={project}
          surface="page"
          anchorRef={buttonRef}
          opener={buttonRef.current}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
