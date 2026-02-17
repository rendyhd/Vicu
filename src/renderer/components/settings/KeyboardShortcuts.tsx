const shortcuts = [
  { category: 'Navigation', items: [
    { keys: ['Up'], description: 'Move to previous task' },
    { keys: ['Down'], description: 'Move to next task' },
    { keys: ['Enter'], description: 'Expand / open task' },
    { keys: ['Escape'], description: 'Collapse task / clear focus' },
  ]},
  { category: 'Task Actions', items: [
    { keys: ['Ctrl', 'N'], description: 'New task' },
    { keys: ['Ctrl', 'V'], description: 'New task from clipboard' },
    { keys: ['Ctrl', 'Enter'], description: 'Save and close task' },
    { keys: ['Ctrl', 'K'], description: 'Complete selected task' },
  ]},
  { category: 'Scheduling', items: [
    { keys: ['Ctrl', 'T'], description: 'Set due date to today' },
    { keys: ['!'], description: 'Set due date to today' },
  ]},
  { category: 'Editing (while task is open)', items: [
    { keys: ['Enter'], description: 'Move focus to notes' },
    { keys: ['Escape'], description: 'Save and close task' },
    { keys: ['Ctrl', 'Enter'], description: 'Save and close task' },
    { keys: ['Ctrl', 'K'], description: 'Complete and close task' },
    { keys: ['Ctrl', 'T'], description: 'Set due date to today' },
  ]},
]

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-1.5 text-2xs font-medium text-[var(--text-secondary)]">
      {children}
    </kbd>
  )
}

export function KeyboardShortcuts() {
  return (
    <div className="mx-6 max-w-lg space-y-6 pb-8 pt-4">
      {shortcuts.map((section) => (
        <div
          key={section.category}
          className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-5"
        >
          <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
            {section.category}
          </h2>
          <div className="space-y-2">
            {section.items.map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-1"
              >
                <span className="text-xs text-[var(--text-secondary)]">
                  {item.description}
                </span>
                <div className="flex items-center gap-1">
                  {item.keys.map((key, j) => (
                    <span key={j} className="flex items-center gap-0.5">
                      {j > 0 && (
                        <span className="text-2xs text-[var(--text-secondary)]">+</span>
                      )}
                      <Kbd>{key}</Kbd>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
