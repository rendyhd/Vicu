import { usePro } from '@/hooks/use-pro'
import { useProUiStore } from '@/stores/pro-ui-store'
import { RecapDialog } from './RecapDialog'
import { CopilotDialog } from './CopilotDialog'
import { ImportDialog } from './ImportDialog'
import { ParkDialog } from './ParkDialog'
import { TriageDialog } from './TriageDialog'
import { WeeklyNoteDialog } from './WeeklyNoteDialog'
import { SessionRecapDialog } from './SessionRecapDialog'
import { PlanDialog } from './PlanDialog'

/** Pro's dialogs, opened from the palette, shortcuts, pages and the paste handler. Drawn once in AppShell. */
export function ProDialogHost() {
  const dialog = useProUiStore((s) => s.dialog)
  const input = useProUiStore((s) => s.dialogInput)
  const close = useProUiStore((s) => s.close)
  const pro = usePro()
  const atCapStart = useProUiStore((s) => s.atCapStart)
  const setAtCapStart = useProUiStore((s) => s.setAtCapStart)
  const triageTask = useProUiStore((s) => s.triageTask)
  const setTriageTask = useProUiStore((s) => s.setTriageTask)
  if (triageTask && pro.layer('portfolio')) return <TriageDialog task={triageTask} onClose={() => setTriageTask(null)} />
  if (atCapStart !== null && pro.layer('portfolio')) return <ParkDialog projectId={null} thenStart={atCapStart} onClose={() => setAtCapStart(null)} />
  if (!dialog || !pro.layer('promises')) return null
  if (dialog === 'pro-recap') return <RecapDialog onClose={close} personId={input?.personId} />
  if (dialog === 'pro-weekly-note') return <WeeklyNoteDialog onClose={close} />
  if (dialog === 'pro-session-recap') return input?.roundId ? <SessionRecapDialog roundId={input.roundId} onClose={close} /> : null
  if (dialog === 'pro-plan') return input?.projectId ? <PlanDialog projectId={input.projectId} onClose={close} openAfterSave /> : null
  if (dialog === 'pro-copilot') return <CopilotDialog onClose={close} personId={input?.personId} />
  return <ImportDialog onClose={close} initialText={input?.text ?? ''} groupLabel={input?.groupLabel} />
}
